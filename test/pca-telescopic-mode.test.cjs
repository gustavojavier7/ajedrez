// Modos telescópicos expuestos en la interfaz: UI → Worker → pcaAnalyzePositionCore.
// Estos tests fijan el contrato de transporte del modo (`disabled` | `shadow` | `active`)
// y el invariante exacto: el modo nunca altera la verdad matemática del solver AND/OR.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Chess } = require('chess.js');

const repoRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(repoRoot, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);

if (!scriptMatch) {
    throw new Error('No se encontró el bloque <script> principal en index.html');
}

// Fixture principal de la prueba manual: mates mínimos múltiples (Kf6, Qb7, Qg1) en 5 plies.
const multiMateFen = '7k/8/8/4K3/8/8/8/1Q6 w - - 0 1';
// Fixtures baratos para telemetría/transporte.
const multiMateInOneFen = '6k1/5Q2/6K1/8/8/8/8/8 w - - 0 1';
const uniqueMateFen = '6k1/3Q4/5K2/8/8/8/8/8 w - - 0 1';
const defendedFen = '6k1/5Q2/6K1/8/8/8/8/6rr w - - 0 1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDocumentStub(initialValues = {}) {
    const elements = new Map();
    const makeElement = (id) => ({
        id,
        textContent: '',
        innerHTML: '',
        value: Object.prototype.hasOwnProperty.call(initialValues, id)
            ? initialValues[id]
            : '',
        hidden: false,
        className: '',
        title: '',
        colSpan: 1,
        style: {},
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
        addEventListener() {},
        appendChild() {},
        replaceChildren() {},
        querySelectorAll: () => []
    });
    return {
        elements,
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, makeElement(id));
            return elements.get(id);
        },
        createElement(tagName) {
            return makeElement('<' + tagName + '>');
        },
        querySelectorAll: () => []
    };
}

function loadRuntime(options = {}) {
    const context = {
        Chess,
        console,
        performance: { now: () => 0, memory: null },
        MutationObserver: function MutationObserver() {},
        Blob: function Blob() {},
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
        Worker: function Worker() {},
        document: options.document || createDocumentStub(),
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(scriptMatch[1], context);
    return context;
}

// Ejecuta el MISMO código de Worker que usa la interfaz (pcaCreateWorkerSource) en un
// sandbox con `self`, para comprobar el camino real UI → Worker → core.
function loadWorkerHarness(runtime) {
    const messages = [];
    const sandbox = {
        self: {
            onmessage: null,
            postMessage(message) {
                messages.push(message);
            }
        },
        Chess,
        console,
        performance: { now: () => Date.now(), memory: null },
        Date,
        Math,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    };
    vm.createContext(sandbox);
    vm.runInContext(runtime.pcaCreateWorkerSource(), sandbox);
    if (typeof sandbox.self.onmessage !== 'function') {
        throw new Error('El Worker generado no registró self.onmessage');
    }
    return {
        messages,
        start(message) {
            const from = messages.length;
            sandbox.self.onmessage({ data: message });
            // Sólo los mensajes terminales del run recién iniciado.
            return messages.slice(from).filter(entry => entry.type === 'RESULT'
                || entry.type === 'TRUNCATED'
                || entry.type === 'ERROR');
        }
    };
}

function truthSlice(result) {
    return {
        status: result.status,
        move: result.move,
        depth: result.depth,
        stopReason: result.stopReason,
        survivors: result.survivors,
        forcedMateTargets: Array.isArray(result.forcedMateTargets)
            ? [...result.forcedMateTargets].sort()
            : result.forcedMateTargets
    };
}

function normalizedResult(result) {
    return {
        status: result.status,
        move: result.move,
        depth: result.depth,
        stopReason: result.stopReason,
        survivors: result.survivors,
        forcedMateTargets: [...(result.forcedMateTargets || [])].sort()
    };
}

function formatCountLike(value) {
    return Number(value).toLocaleString('es-ES');
}

// ---------------------------------------------------------------------------
// 1. El modo seleccionado llega correctamente al core
// ---------------------------------------------------------------------------

test('1: la UI normaliza el modo y lo transporta explícito en el mensaje START', () => {
    const documentStub = createDocumentStub({ pcaTelescopicMode: 'active' });
    const runtime = loadRuntime({ document: documentStub });

    assert.equal(typeof runtime.pcaNormalizeTelescopicMode, 'function');
    assert.equal(typeof runtime.pcaReadTelescopicMode, 'function');
    assert.equal(typeof runtime.pcaCreateWorkerStartMessage, 'function');

    // Lectura fail-closed desde el selector compacto de la interfaz.
    assert.equal(runtime.pcaReadTelescopicMode(), 'active');
    assert.equal(runtime.pcaNormalizeTelescopicMode('disabled'), 'disabled');
    assert.equal(runtime.pcaNormalizeTelescopicMode('shadow'), 'shadow');
    assert.equal(runtime.pcaNormalizeTelescopicMode('active'), 'active');
    assert.equal(runtime.pcaNormalizeTelescopicMode(' ACTIVE '), 'active');
    assert.equal(runtime.pcaNormalizeTelescopicMode('bogus'), 'disabled');
    assert.equal(runtime.pcaNormalizeTelescopicMode(null), 'disabled');
    assert.equal(runtime.pcaNormalizeTelescopicMode(undefined), 'disabled');
    assert.equal(runtime.pcaNormalizeTelescopicMode(9999), 'disabled');

    const start = runtime.pcaCreateWorkerStartMessage({
        runId: 7,
        fen: multiMateInOneFen,
        kGuard: 2,
        telescopicPolicy: 'active'
    });
    assert.equal(start.type, 'START');
    assert.equal(start.runId, 7);
    assert.equal(start.fen, multiMateInOneFen);
    assert.equal(start.kGuard, 2);
    assert.equal(start.telescopicPolicy, 'active');
    assert.equal(Object.prototype.hasOwnProperty.call(start, 'telescopicPolicy'), true);

    // El Worker generado debe leer explícitamente el campo transportado.
    assert.match(runtime.pcaCreateWorkerSource(), /message\.telescopicPolicy/);
    // La UI debe usar el constructor de mensaje (no un postMessage ad-hoc sin modo).
    assert.ok(
        scriptMatch[1].includes('pcaWorker.postMessage(pcaCreateWorkerStartMessage('),
        'analyzePCAChess debe enviar el modo mediante pcaCreateWorkerStartMessage'
    );
});

test('1b: el modo llega al Worker y cambia la política realmente usada por el core', () => {
    const runtime = loadRuntime();
    const worker = loadWorkerHarness(runtime);

    const activeStart = runtime.pcaCreateWorkerStartMessage({
        runId: 1,
        fen: multiMateInOneFen,
        kGuard: 2,
        telescopicPolicy: 'active'
    });
    const activeMessages = worker.start(activeStart);
    const activeResult = activeMessages.find(message => message.pcaResult);
    assert.ok(activeResult, 'el Worker debe responder con pcaResult');
    assert.equal(activeResult.pcaResult.telescopicMode, 'active');
    assert.ok(activeResult.pcaResult.activeInvocations >= 1, 'ACTIVE debe invocar la política');
    assert.ok(activeResult.pcaResult.reordersApplied >= 1, 'ACTIVE debe reordenar');

    const shadowStart = runtime.pcaCreateWorkerStartMessage({
        runId: 2,
        fen: multiMateInOneFen,
        kGuard: 2,
        telescopicPolicy: 'shadow'
    });
    const shadowResult = worker.start(shadowStart).find(message => message.pcaResult);
    assert.equal(shadowResult.pcaResult.telescopicMode, 'shadow');
    assert.equal(shadowResult.pcaResult.activeInvocations, 0);
    assert.ok(shadowResult.pcaResult.shadowInvocations >= 1);

    const disabledStart = runtime.pcaCreateWorkerStartMessage({
        runId: 3,
        fen: multiMateInOneFen,
        kGuard: 2,
        telescopicPolicy: 'disabled'
    });
    const disabledResult = worker.start(disabledStart).find(message => message.pcaResult);
    assert.equal(disabledResult.pcaResult.telescopicMode, 'disabled');
    assert.equal(disabledResult.pcaResult.activeInvocations, 0);
    assert.equal(disabledResult.pcaResult.shadowInvocations, 0);
    assert.equal(disabledResult.pcaResult.reordersApplied, 0);

    // Misma FEN + mismo K ⇒ misma verdad exacta en los tres modos, a través del Worker.
    assert.deepEqual(normalizedResult(activeResult.pcaResult), normalizedResult(disabledResult.pcaResult));
    assert.deepEqual(normalizedResult(shadowResult.pcaResult), normalizedResult(disabledResult.pcaResult));
});

// ---------------------------------------------------------------------------
// 2. DISABLED conserva el comportamiento previo
// ---------------------------------------------------------------------------

test('2: DISABLED es idéntico al comportamiento previo (sin opción telescópica)', () => {
    const runtime = loadRuntime();
    const worker = loadWorkerHarness(runtime);

    for (const fixture of [
        { fen: uniqueMateFen, k: 2 },
        { fen: multiMateInOneFen, k: 2 },
        { fen: defendedFen, k: 2 },
        { fen: multiMateFen, k: 3 }
    ]) {
        const baseline = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {});
        const disabled = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            telescopicPolicy: 'disabled'
        });
        assert.deepEqual(truthSlice(disabled), truthSlice(baseline));
        assert.equal(disabled.nodes, baseline.nodes);
        assert.equal(disabled.depth, baseline.depth);
        assert.equal(disabled.status, baseline.status);
        assert.equal(disabled.stopReason, baseline.stopReason);
        assert.equal(disabled.telescopicMode, 'disabled');
        assert.equal(disabled.activeInvocations, 0);
        assert.equal(disabled.shadowInvocations, 0);
        assert.equal(disabled.reordersApplied, 0);
        assert.equal(disabled.reordersRejected, 0);
        assert.equal(disabled.orderFallbacks, 0);
        assert.equal(disabled.rootReorders, 0);
        assert.equal(disabled.internalReorders, 0);
    }

    // Transporte completo por el Worker con DISABLED ⇒ mismo resultado exacto.
    const workerDisabled = worker.start(runtime.pcaCreateWorkerStartMessage({
        runId: 11,
        fen: uniqueMateFen,
        kGuard: 2,
        telescopicPolicy: 'disabled'
    })).find(message => message.pcaResult);
    const coreDisabled = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        telescopicPolicy: 'disabled'
    });
    assert.deepEqual(normalizedResult(workerDisabled.pcaResult), normalizedResult(coreDisabled));
    assert.equal(workerDisabled.pcaResult.telescopicMode, 'disabled');
});

// ---------------------------------------------------------------------------
// 3. SHADOW no altera resultado ni nodos respecto de DISABLED
// ---------------------------------------------------------------------------

test('3: SHADOW observa sin reordenar: mismos nodos y misma verdad que DISABLED', () => {
    const runtime = loadRuntime();

    for (const fixture of [
        { fen: uniqueMateFen, k: 2 },
        { fen: multiMateInOneFen, k: 2 },
        { fen: defendedFen, k: 2 },
        { fen: multiMateFen, k: 3 }
    ]) {
        const disabled = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            telescopicPolicy: 'disabled'
        });
        const shadow = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            telescopicPolicy: 'shadow'
        });

        assert.deepEqual(truthSlice(shadow), truthSlice(disabled));
        assert.equal(shadow.nodes, disabled.nodes);
        assert.equal(shadow.telescopicMode, 'shadow');
        assert.ok(shadow.shadowInvocations >= 1, 'SHADOW debe observar contextos');
        assert.equal(shadow.activeInvocations, 0);
        assert.equal(shadow.reordersApplied, 0);
        assert.equal(shadow.rootReorders + shadow.internalReorders, 0);
    }
});

test('3b: SHADOW transporta sus contadores al PROGRESS pero nunca certifica verdad', () => {
    const runtime = loadRuntime();
    const samples = [];
    const result = runtime.pcaAnalyzePositionCore(multiMateFen, 3, {
        telescopicPolicy: 'shadow',
        onProgress: progress => samples.push(progress)
    });

    assert.ok(samples.length > 0, 'debe emitir PROGRESS');
    const observed = samples.filter(sample => sample.shadowInvocations != null);
    if (observed.length > 0) {
        assert.equal(observed[observed.length - 1].telescopicMode, 'shadow');
        assert.ok(observed[observed.length - 1].shadowInvocations >= 1);
        assert.equal(observed[observed.length - 1].activeInvocations, 0);
    }
    assert.equal(result.telescopicMode, 'shadow');
    assert.equal(result.activeInvocations, 0);
});

// ---------------------------------------------------------------------------
// 4. ACTIVE conserva exactamente la verdad matemática
// ---------------------------------------------------------------------------

test('4: ACTIVE conserva la verdad exacta (fixture principal, K suficiente)', () => {
    const runtime = loadRuntime();

    const disabled = runtime.pcaAnalyzePositionCore(multiMateFen, 5, {
        telescopicPolicy: 'disabled'
    });
    const shadow = runtime.pcaAnalyzePositionCore(multiMateFen, 5, {
        telescopicPolicy: 'shadow'
    });
    const active = runtime.pcaAnalyzePositionCore(multiMateFen, 5, {
        telescopicPolicy: 'active'
    });

    assert.equal(disabled.status, 'DECIDED_MULTIPLE');
    assert.equal(disabled.stopReason, 'MULTIPLE_SHORTEST_FORCED_MATES');
    assert.equal(disabled.depth, 5);
    assert.equal(disabled.survivors, 3);
    assert.deepEqual(truthSlice(disabled).forcedMateTargets, ['Kf6', 'Qb7', 'Qg1']);

    assert.deepEqual(truthSlice(shadow), truthSlice(disabled));
    assert.deepEqual(truthSlice(active), truthSlice(disabled));

    assert.equal(active.telescopicMode, 'active');
    assert.ok(active.activeInvocations >= 1);
    assert.ok(active.reordersApplied >= 1);
    assert.ok(active.rootReorders >= 1);
    assert.ok(active.internalReorders >= 1);
    assert.equal(active.reordersRejected, 0);
    assert.equal(active.orderFallbacks, 0);
    // Los nodos pueden diferir por el reordenamiento; la verdad exacta no.
    assert.ok(Number.isFinite(active.nodes) && active.nodes > 0);
});

test('4b: ACTIVE por el Worker (transporte real) mantiene la verdad exacta', () => {
    const runtime = loadRuntime();
    const worker = loadWorkerHarness(runtime);

    const disabled = runtime.pcaAnalyzePositionCore(multiMateFen, 5, {
        telescopicPolicy: 'disabled'
    });
    const workerActive = worker.start(runtime.pcaCreateWorkerStartMessage({
        runId: 42,
        fen: multiMateFen,
        kGuard: 5,
        telescopicPolicy: 'active'
    })).find(message => message.pcaResult);

    assert.ok(workerActive, 'el Worker debe devolver pcaResult');
    assert.equal(workerActive.pcaResult.telescopicMode, 'active');
    assert.ok(workerActive.pcaResult.activeInvocations >= 1);
    assert.deepEqual(normalizedResult(workerActive.pcaResult), normalizedResult(disabled));
    assert.equal(workerActive.pcaResult.survivors, disabled.survivors);
});

// ---------------------------------------------------------------------------
// 5. Una política ACTIVE inválida sigue cayendo al orden seguro
// ---------------------------------------------------------------------------

test('5: política ACTIVE inválida falla cerrada al orden semántico', () => {
    const runtime = loadRuntime();
    const disabled = runtime.pcaAnalyzePositionCore(multiMateFen, 3, {
        telescopicPolicy: 'disabled'
    });

    const invalidPolicies = [
        { label: 'rank null', rank: () => null },
        { label: 'rank elimina candidato', rank: (context, ids) => ids.slice(0, -1) },
        { label: 'rank duplica candidato', rank: (context, ids) => ids.concat([ids[0]]) },
        { label: 'rank inventa identidad', rank: (context, ids) => ids.map(() => 'ZZ') },
        {
            label: 'rank lanza',
            rank: () => {
                throw new Error('boom');
            }
        }
    ];

    for (const scenario of invalidPolicies) {
        const active = runtime.pcaAnalyzePositionCore(multiMateFen, 3, {
            telescopicPolicy: runtime.pcaCreateActiveTelescopicPolicy({ rank: scenario.rank })
        });
        assert.deepEqual(truthSlice(active), truthSlice(disabled), scenario.label);
        assert.equal(active.nodes, disabled.nodes, scenario.label + ': orden seguro ⇒ mismos nodos');
        assert.equal(active.telescopicMode, 'active', scenario.label);
        assert.ok(active.reordersRejected >= 1, scenario.label);
        assert.ok(active.orderFallbacks >= 1, scenario.label);
        assert.equal(active.reordersApplied, 0, scenario.label);
        assert.equal(active.rootReorders, 0, scenario.label);
        assert.equal(active.internalReorders, 0, scenario.label);
    }
});

test('5b: un modo inválido del selector cae a DISABLED de punta a punta', () => {
    const runtime = loadRuntime();
    const worker = loadWorkerHarness(runtime);

    const start = runtime.pcaCreateWorkerStartMessage({
        runId: 5,
        fen: multiMateInOneFen,
        kGuard: 2,
        telescopicPolicy: 'no-existe'
    });
    assert.equal(start.telescopicPolicy, 'disabled');

    const workerResult = worker.start(start).find(message => message.pcaResult);
    assert.equal(workerResult.pcaResult.telescopicMode, 'disabled');
    assert.equal(workerResult.pcaResult.activeInvocations, 0);
    assert.equal(workerResult.pcaResult.shadowInvocations, 0);

    const coreReference = runtime.pcaAnalyzePositionCore(multiMateInOneFen, 2, {
        telescopicPolicy: 'disabled'
    });
    assert.deepEqual(normalizedResult(workerResult.pcaResult), normalizedResult(coreReference));
});

// ---------------------------------------------------------------------------
// 6. NPS / tiempo no influyen en la selección del modo ni en el ranking
// ---------------------------------------------------------------------------

test('6: NPS y tiempo no influyen en la selección del modo', () => {
    const runtime = loadRuntime();

    assert.equal(runtime.pcaResolveTelescopicMode({ telescopicPolicy: 'active', nps: 99999 }), 'active');
    assert.equal(runtime.pcaResolveTelescopicMode({ telescopicPolicy: 'shadow', nps: 1 }), 'shadow');
    assert.equal(
        runtime.pcaResolveTelescopicMode({ telescopicPolicy: 'disabled', elapsedMs: 1e9 }),
        'disabled'
    );
    assert.equal(
        runtime.pcaResolveTelescopicMode({ telescopicPolicy: 'active', elapsedMs: 1, nodes: 1 }),
        runtime.pcaResolveTelescopicMode({ telescopicPolicy: 'active', elapsedMs: 1e9, nodes: 1e9 })
    );
    // Un número/tiempo nunca se interpreta como modo.
    assert.equal(runtime.pcaNormalizeTelescopicMode(1234), 'disabled');
    assert.equal(runtime.pcaResolveTelescopicMode({ telescopicPolicy: 1234 }), 'disabled');
});

test('6b: el ranking ACTIVE ignora NPS/tiempo y el solver es determinista ante el reloj', () => {
    const runtime = loadRuntime();
    const views = [
        { identity: 'A', moveIndex: 0, hypothesesAfter: 2, informationGain: 1, contractionRatio: 0.2, classMateRate: 0.1, mateScore: 1 },
        { identity: 'B', moveIndex: 1, hypothesesAfter: 1, informationGain: 3, contractionRatio: 0.8, classMateRate: 0.9, mateScore: 4 },
        { identity: 'C', moveIndex: 2, hypothesesAfter: 3, informationGain: 0, contractionRatio: 0.1, classMateRate: 0.0, mateScore: 0 }
    ];
    const identities = ['A', 'B', 'C'];

    const plainContext = runtime.pcaBuildTelescopicContext({
        attackerTurn: true,
        candidateIdentities: identities,
        candidateViews: views
    });
    const npsContext = runtime.pcaBuildTelescopicContext({
        attackerTurn: true,
        candidateIdentities: identities,
        candidateViews: views.map(view => Object.assign({}, view, {
            nps: 999999,
            elapsedMs: 12345,
            nodes: 987654
        }))
    });

    const plainRank = runtime.pcaDefaultActiveRank(plainContext, identities.slice());
    const npsRank = runtime.pcaDefaultActiveRank(npsContext, identities.slice());
    assert.deepEqual(npsRank, plainRank);

    const reference = runtime.pcaAnalyzePositionCore(multiMateFen, 3, {
        telescopicPolicy: 'active'
    });

    const originalDateNow = runtime.Date.now;
    const originalPerfNow = runtime.performance.now;
    try {
        runtime.Date.now = () => 1e12;
        runtime.performance.now = () => 5e9;
        const timed = runtime.pcaAnalyzePositionCore(multiMateFen, 3, {
            telescopicPolicy: 'active'
        });
        assert.deepEqual(truthSlice(timed), truthSlice(reference));
        assert.equal(timed.nodes, reference.nodes);
        assert.equal(timed.activeInvocations, reference.activeInvocations);
        assert.equal(timed.reordersApplied, reference.reordersApplied);
        assert.equal(timed.rootReorders, reference.rootReorders);
        assert.equal(timed.internalReorders, reference.internalReorders);
    } finally {
        runtime.Date.now = originalDateNow;
        runtime.performance.now = originalPerfNow;
    }
});

// ---------------------------------------------------------------------------
// 7. Telemetría visible en el panel PCA
// ---------------------------------------------------------------------------

test('7: el panel PCA expone modo y contadores de reorder (— si no hay dato)', () => {
    const documentStub = createDocumentStub();
    const runtime = loadRuntime({ document: documentStub });

    // Contrato de interfaz: control compacto + celdas de telemetría.
    assert.ok(html.includes('id="pcaTelescopicMode"'), 'falta el selector PCA MODE');
    assert.ok(/<option value="disabled"/.test(html));
    assert.ok(/<option value="shadow"/.test(html));
    assert.ok(/<option value="active"/.test(html));
    for (const id of [
        'pcaTelescopicModeValue',
        'pcaActiveInvocations',
        'pcaReordersApplied',
        'pcaReordersRejected',
        'pcaOrderFallbacks',
        'pcaRootReorders',
        'pcaInternalReorders'
    ]) {
        assert.ok(html.includes(`id="${id}"`), `falta el nodo de telemetría ${id}`);
    }

    // Estado RUNNING sin telemetría telescópica ⇒ modo visible y contadores en "—".
    runtime.updatePCAMetrics({
        status: 'RUNNING',
        move: null,
        depth: 0,
        nodes: 0,
        elapsedMs: 0,
        stopReason: 'STARTING',
        telescopicMode: 'shadow'
    });
    const element = id => documentStub.getElementById(id).textContent;
    assert.equal(element('pcaTelescopicModeValue'), 'SHADOW');
    assert.equal(element('pcaActiveInvocations'), '—');
    assert.equal(element('pcaReordersApplied'), '—');
    assert.equal(element('pcaReordersRejected'), '—');
    assert.equal(element('pcaOrderFallbacks'), '—');
    assert.equal(element('pcaRootReorders'), '—');
    assert.equal(element('pcaInternalReorders'), '—');

    // Resultado final: todos los contadores se publican sin inventar valores.
    runtime.updatePCAMetrics({
        status: 'DECIDED_MULTIPLE',
        move: null,
        depth: 5,
        nodes: 11219,
        elapsedMs: 1500,
        stopReason: 'MULTIPLE_SHORTEST_FORCED_MATES',
        telescopicMode: 'active',
        activeInvocations: 1281,
        reordersApplied: 884,
        reordersRejected: 2,
        orderFallbacks: 2,
        rootReorders: 5,
        internalReorders: 879
    });
    assert.equal(element('pcaTelescopicModeValue'), 'ACTIVE');
    assert.equal(element('pcaActiveInvocations'), formatCountLike(1281));
    assert.equal(element('pcaReordersApplied'), formatCountLike(884));
    assert.equal(element('pcaReordersRejected'), formatCountLike(2));
    assert.equal(element('pcaOrderFallbacks'), formatCountLike(2));
    assert.equal(element('pcaRootReorders'), formatCountLike(5));
    assert.equal(element('pcaInternalReorders'), formatCountLike(879));
    // Las métricas previas siguen vivas (no se elimina PCA SCORE ni nodos/status/K/tiempo).
    assert.notEqual(element('pcaNodes'), '—');
    assert.notEqual(element('pcaDepth'), '—');
    assert.equal(documentStub.getElementById('pcaStatus').textContent, 'DECIDED_MULTIPLE');
    assert.ok(documentStub.getElementById('pcaDiagnosticScore').textContent.length > 0);
});
