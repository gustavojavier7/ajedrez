const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Chess } = require('chess.js');

const repoRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);

if (!scriptMatch) {
    throw new Error('No se encontró el bloque <script> principal en index.html');
}

function loadRuntime() {
    const context = {
        Chess,
        console,
        performance: { now: () => 0, memory: null },
        MutationObserver: function MutationObserver() {},
        Blob: function Blob() {},
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
        Worker: function Worker() {},
        document: { getElementById: () => null },
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

// Multiple shortest forced mates (mate in 5): Kf6, Qb7, Qg1.
const multiMateFen = '7k/8/8/4K3/8/8/8/1Q6 w - - 0 1';
// Fast multiple mate-in-1 fixture for lightweight telemetry checks.
const multiMateInOneFen = '6k1/5Q2/6K1/8/8/8/8/8 w - - 0 1';
// Unique mate in one: only Qg7#.
const uniqueMateFen = '6k1/3Q4/5K2/8/8/8/8/8 w - - 0 1';
const defendedFen = '6k1/5Q2/6K1/8/8/8/8/6rr w - - 0 1';

test('cambiar NPS artificial no cambia el orden semántico PCA', () => {
    const runtime = loadRuntime();
    const base = [
        { moveIndex: 0, hypothesesAfter: 2, infoGain: 1, classMateRate: 0.1, mateScore: 1, nps: 9999 },
        { moveIndex: 1, hypothesesAfter: 1, infoGain: 3, classMateRate: 0.9, mateScore: 4, nps: 1 }
    ];
    const swapped = base.map(candidate => ({
        ...candidate,
        nps: candidate.moveIndex === 0 ? 1 : 9999
    }));

    const orderedA = runtime.pcaOrderSemanticCandidates(base, true).map(candidate => candidate.moveIndex);
    const orderedB = runtime.pcaOrderSemanticCandidates(swapped, true).map(candidate => candidate.moveIndex);

    assert.deepEqual(orderedA, [1, 0]);
    assert.deepEqual(orderedA, orderedB);
});

test('dos FEN idénticas producen el mismo descriptor y no depende del tiempo', () => {
    const runtime = loadRuntime();
    const descriptorA = runtime.describeFEN(uniqueMateFen);
    const originalDateNow = runtime.Date.now;
    try {
        runtime.performance.now = () => 123456;
        runtime.Date.now = () => 987654321;
        const descriptorB = runtime.describeFEN(uniqueMateFen);
        assert.deepEqual(descriptorA, descriptorB);
    } finally {
        runtime.Date.now = originalDateNow;
    }
});

test('PCA nunca certifica mate sin el solver exacto AND/OR', () => {
    const runtime = loadRuntime();
    const debug = {};
    const result = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, { debug });

    assert.equal(result.status, 'DECIDED_UNIQUE');
    assert.equal(result.stopReason, 'FORCED_MATE_CERTIFIED');
    assert.equal(debug.rootCutoff.type, 'ROOT_OR_CERTIFIED');
});

test('una defensa que refuta el mate corta inmediatamente un nodo AND', () => {
    const runtime = loadRuntime();
    const debug = {};
    const result = runtime.pcaAnalyzePositionCore(defendedFen, 2, { debug });

    assert.equal(result.status, 'UNRESOLVED');
    assert.equal(debug.lastCutoff.type, 'AND_REFUTED');
});

test('una continuación certificada basta para resolver un nodo OR', () => {
    const runtime = loadRuntime();
    const debug = {};
    const result = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, { debug });

    assert.equal(result.status, 'DECIDED_UNIQUE');
    assert.equal(result.depth, 1);
    assert.equal(debug.lastCutoff.type, 'OR_CERTIFIED');
});

test('una colisión de descriptor queda registrada', () => {
    const runtime = loadRuntime();
    const descriptor = runtime.describeFEN(uniqueMateFen);
    const context = {
        classCache: new Map(),
        collisionMap: new Map()
    };

    runtime.pcaRegisterDescriptorOutcome(descriptor, 2, true, uniqueMateFen, context);
    runtime.pcaRegisterDescriptorOutcome(descriptor, 2, false, defendedFen, context);

    assert.equal(context.collisionMap.size, 1);
    const collision = Array.from(context.collisionMap.values())[0];
    assert.equal(collision.outcomeA, 'MATE');
    assert.equal(collision.outcomeB, 'NO_MATE');
    assert.equal(collision.depth, 2);
});

test('refinar el descriptor no cambia resultados exactos ya certificados', () => {
    const runtime = loadRuntime();
    const refinedDescribeFEN = runtime.pcaRefineDescriptor(
        runtime.describeFEN,
        'mobilityBand',
        (fen, descriptor) => `${descriptor.sideToMove}:${Math.min(descriptor.legalMoveCount, 8)}`
    );

    const baseResult = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {});
    const refinedResult = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        describeFEN: refinedDescribeFEN
    });

    assert.equal(refinedResult.status, baseResult.status);
    assert.equal(refinedResult.move, baseResult.move);
    assert.equal(refinedResult.depth, baseResult.depth);
    assert.equal(refinedDescribeFEN(uniqueMateFen).refinements.mobilityBand, 'w:8');
});

test('la corrección exacta no cambia sin telemetría NPS y con PCA desactivado', () => {
    const runtime = loadRuntime();
    const withSemanticOrdering = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {});
    const withoutSemanticOrdering = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        semanticOrdering: false
    });
    const withoutProgressTelemetry = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        onProgress: () => {}
    });

    assert.equal(withSemanticOrdering.status, withoutSemanticOrdering.status);
    assert.equal(withSemanticOrdering.move, withoutSemanticOrdering.move);
    assert.equal(withSemanticOrdering.depth, withoutSemanticOrdering.depth);
    assert.equal(withSemanticOrdering.status, withoutProgressTelemetry.status);
    assert.equal(withSemanticOrdering.move, withoutProgressTelemetry.move);
});

test('mates mínimos múltiples certificados son DECIDED_MULTIPLE e independientes del orden PCA', () => {
    const runtime = loadRuntime();
    const withPca = runtime.pcaAnalyzePositionCore(multiMateFen, 6, { semanticOrdering: true });
    const withoutPca = runtime.pcaAnalyzePositionCore(multiMateFen, 6, { semanticOrdering: false });

    assert.equal(withPca.status, 'DECIDED_MULTIPLE');
    assert.equal(withPca.stopReason, 'MULTIPLE_SHORTEST_FORCED_MATES');
    assert.equal(withPca.depth, 5);
    assert.equal(withPca.move, null);
    assert.ok(withPca.survivors > 1);
    assert.deepEqual(
        [...withPca.forcedMateTargets].sort(),
        [...withoutPca.forcedMateTargets].sort()
    );
    assert.equal(withoutPca.status, withPca.status);
    assert.equal(withoutPca.stopReason, withPca.stopReason);
    assert.equal(withoutPca.depth, withPca.depth);
    assert.equal(withoutPca.survivors, withPca.survivors);
    assert.equal(withoutPca.move, null);
    assert.equal(withPca.survivors, withPca.forcedMateTargets.length);
    assert.ok(withPca.forcedMateTargets.length > 1);
});

test('mate mínimo único es DECIDED_UNIQUE con y sin orden PCA', () => {
    const runtime = loadRuntime();
    const withPca = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, { semanticOrdering: true });
    const withoutPca = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, { semanticOrdering: false });

    assert.equal(withPca.status, 'DECIDED_UNIQUE');
    assert.equal(withPca.stopReason, 'FORCED_MATE_CERTIFIED');
    assert.equal(withPca.depth, 1);
    assert.equal(withPca.move, 'Qg7#');
    assert.equal(withPca.survivors, 1);
    assert.deepEqual([...withPca.forcedMateTargets], ['Qg7#']);
    assert.equal(withoutPca.status, withPca.status);
    assert.equal(withoutPca.move, withPca.move);
    assert.equal(withoutPca.stopReason, withPca.stopReason);
    assert.equal(withoutPca.survivors, withPca.survivors);
    assert.deepEqual([...withoutPca.forcedMateTargets], [...withPca.forcedMateTargets]);
});

test('UNRESOLVED queda reservado para búsquedas incompletas o no decididas', () => {
    const runtime = loadRuntime();
    const defended = runtime.pcaAnalyzePositionCore(defendedFen, 2, {});
    const shallow = runtime.pcaAnalyzePositionCore(uniqueMateFen, 0, {});

    assert.equal(defended.status, 'UNRESOLVED');
    assert.notEqual(defended.status, 'DECIDED_MULTIPLE');
    assert.notEqual(defended.stopReason, 'MULTIPLE_SHORTEST_FORCED_MATES');
    assert.ok(
        shallow.status === 'UNDEFINED' ||
        shallow.status === 'UNRESOLVED' ||
        shallow.stopReason === 'INVALID_K_GUARD'
    );
});

test('pcaSquaresBetween excluye origen/destino y conserva todas las casillas intermedias', () => {
    const runtime = loadRuntime();

    assert.deepEqual([...runtime.pcaSquaresBetween('a1', 'a8')], ['a2', 'a3', 'a4', 'a5', 'a6', 'a7']);
    assert.deepEqual([...runtime.pcaSquaresBetween('a1', 'd4')], ['b2', 'c3']);
    assert.deepEqual([...runtime.pcaSquaresBetween('a1', 'b2')], []);
});

test('checkBlockable detecta interposiciones en jaques de torre, alfil y dama', () => {
    const runtime = loadRuntime();

    const rookCheck = '4k3/8/8/8/1b6/8/8/4R3 b - - 0 1';
    const bishopCheck = '4k3/8/8/8/B7/8/8/1r6 b - - 0 1';
    const queenCheck = '4k3/8/8/8/8/8/r7/4Q3 b - - 0 1';

    const rookDescriptor = runtime.describeFEN(rookCheck);
    const bishopDescriptor = runtime.describeFEN(bishopCheck);
    const queenDescriptor = runtime.describeFEN(queenCheck);

    assert.equal(rookDescriptor.inCheck, true);
    assert.equal(rookDescriptor.checkerType, 'r');
    assert.equal(rookDescriptor.checkBlockable, true);

    assert.equal(bishopDescriptor.inCheck, true);
    assert.equal(bishopDescriptor.checkerType, 'b');
    assert.equal(bishopDescriptor.checkBlockable, true);

    assert.equal(queenDescriptor.inCheck, true);
    assert.equal(queenDescriptor.checkerType, 'q');
    assert.equal(queenDescriptor.checkBlockable, true);

    // Blocking square nearest the king must remain visible after the pop() fix.
    assert.ok(runtime.pcaSquaresBetween('e1', 'e8').includes('e7'));
    assert.ok(runtime.pcaSquaresBetween('a4', 'e8').includes('d7'));
});

test('NPS artificial no altera la clasificación exacta DECIDED_UNIQUE/DECIDED_MULTIPLE', () => {
    const runtime = loadRuntime();
    const samples = [];
    const onProgress = (progress) => {
        samples.push(progress);
    };

    const unique = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, { onProgress });
    const multiple = runtime.pcaAnalyzePositionCore(multiMateInOneFen, 2, { onProgress });
    const uniqueQuiet = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {});
    const multipleQuiet = runtime.pcaAnalyzePositionCore(multiMateInOneFen, 2, {});

    assert.equal(unique.status, 'DECIDED_UNIQUE');
    assert.equal(multiple.status, 'DECIDED_MULTIPLE');
    assert.equal(unique.status, uniqueQuiet.status);
    assert.equal(unique.move, uniqueQuiet.move);
    assert.equal(unique.stopReason, uniqueQuiet.stopReason);
    assert.equal(unique.survivors, uniqueQuiet.survivors);
    assert.equal(multiple.status, multipleQuiet.status);
    assert.equal(multiple.stopReason, multipleQuiet.stopReason);
    assert.equal(multiple.survivors, multipleQuiet.survivors);
    assert.deepEqual(
        [...multiple.forcedMateTargets].sort(),
        [...multipleQuiet.forcedMateTargets].sort()
    );
    assert.ok(samples.length > 0);
});

// ---------------------------------------------------------------------------
// BASELINE PCA
// Frozen pre-telescopic exact-solver contract. Later phases must keep:
//   policy disabled == BASELINE PCA == shadow (exact fields)
// Result fields: status, move, depth, stopReason, survivors, forcedMateTargets.
// Contractual telescopic equality ALSO includes nodes (ordering on/off may differ).
// Fixtures: unique min-mate, multiple min-mate, defended/unresolved, descriptor collision.
// ---------------------------------------------------------------------------

function pcaBaselineExactSlice(result) {
    return {
        status: result.status,
        move: result.move,
        depth: result.depth,
        stopReason: result.stopReason,
        survivors: result.survivors,
        forcedMateTargets: Array.isArray(result.forcedMateTargets)
            ? [...result.forcedMateTargets]
            : result.forcedMateTargets
    };
}

function pcaBaselineExactSliceCanonical(result) {
    const slice = pcaBaselineExactSlice(result);
    return Object.assign({}, slice, {
        forcedMateTargets: Array.isArray(slice.forcedMateTargets)
            ? [...slice.forcedMateTargets].sort()
            : slice.forcedMateTargets
    });
}

// Contractual equality for baseline == disabled == shadow (includes nodes).
function pcaContractualExactSlice(result) {
    return Object.assign({}, pcaBaselineExactSlice(result), {
        nodes: result.nodes
    });
}

function pcaContractualExactSliceCanonical(result) {
    return Object.assign({}, pcaBaselineExactSliceCanonical(result), {
        nodes: result.nodes
    });
}

test('BASELINE PCA: forcedMateTargets completo es idéntico con y sin orden semántico', () => {
    const runtime = loadRuntime();

    const uniqueOn = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, { semanticOrdering: true });
    const uniqueOff = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, { semanticOrdering: false });
    const multiOn = runtime.pcaAnalyzePositionCore(multiMateFen, 6, { semanticOrdering: true });
    const multiOff = runtime.pcaAnalyzePositionCore(multiMateFen, 6, { semanticOrdering: false });
    const defendedOn = runtime.pcaAnalyzePositionCore(defendedFen, 2, { semanticOrdering: true });
    const defendedOff = runtime.pcaAnalyzePositionCore(defendedFen, 2, { semanticOrdering: false });

    assert.deepEqual(
        pcaBaselineExactSliceCanonical(uniqueOn),
        pcaBaselineExactSliceCanonical(uniqueOff)
    );
    assert.deepEqual([...uniqueOn.forcedMateTargets], ['Qg7#']);
    assert.deepEqual([...uniqueOff.forcedMateTargets], ['Qg7#']);

    assert.deepEqual(
        pcaBaselineExactSliceCanonical(multiOn),
        pcaBaselineExactSliceCanonical(multiOff)
    );
    assert.ok(multiOn.forcedMateTargets.length > 1);
    assert.deepEqual(
        [...multiOn.forcedMateTargets].sort(),
        [...multiOff.forcedMateTargets].sort()
    );
    // Full content equality of the mate set (not only .move).
    assert.equal(multiOn.forcedMateTargets.length, multiOn.survivors);
    assert.equal(multiOff.forcedMateTargets.length, multiOff.survivors);

    assert.equal(defendedOn.status, 'UNRESOLVED');
    assert.equal(defendedOff.status, 'UNRESOLVED');
    assert.deepEqual(
        pcaBaselineExactSliceCanonical(defendedOn),
        pcaBaselineExactSliceCanonical(defendedOff)
    );
});

test('BASELINE PCA: fingerprint contractual de fixtures canónicos', () => {
    const runtime = loadRuntime();
    const baseline = {
        unique: pcaBaselineExactSlice(
            runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, { semanticOrdering: true })
        ),
        multiple: pcaBaselineExactSliceCanonical(
            runtime.pcaAnalyzePositionCore(multiMateFen, 6, { semanticOrdering: true })
        ),
        defended: pcaBaselineExactSlice(
            runtime.pcaAnalyzePositionCore(defendedFen, 2, { semanticOrdering: true })
        )
    };

    assert.deepEqual(baseline.unique, {
        status: 'DECIDED_UNIQUE',
        move: 'Qg7#',
        depth: 1,
        stopReason: 'FORCED_MATE_CERTIFIED',
        survivors: 1,
        forcedMateTargets: ['Qg7#']
    });
    assert.equal(baseline.multiple.status, 'DECIDED_MULTIPLE');
    assert.equal(baseline.multiple.move, null);
    assert.equal(baseline.multiple.depth, 5);
    assert.equal(baseline.multiple.stopReason, 'MULTIPLE_SHORTEST_FORCED_MATES');
    assert.ok(baseline.multiple.survivors > 1);
    assert.equal(baseline.multiple.forcedMateTargets.length, baseline.multiple.survivors);
    assert.equal(baseline.defended.status, 'UNRESOLVED');
    assert.equal(baseline.defended.move, null);
    assert.equal(baseline.defended.depth, 2);
    assert.equal(baseline.defended.survivors, 0);
    assert.equal(baseline.defended.stopReason, 'NO_FORCED_MATE_WITHIN_K_GUARD');
});

// ---------------------------------------------------------------------------
// FASE 1 — telescopic contracts + shadow mode (no semantic effect)
// BASELINE == TELESCOPIC DISABLED == TELESCOPIC SHADOW
// ---------------------------------------------------------------------------

test('contratos telescópicos mínimos existen y son inocuos', () => {
    const runtime = loadRuntime();
    const query = runtime.pcaCreateQuery({ horizonValue: 3 });
    assert.equal(query.domainId, 'CHESS');
    assert.equal(query.goal, 'ALL_SHORTEST_FORCED_MATES');
    assert.equal(query.horizon.unit, 'PLIES');
    assert.equal(query.horizon.value, 3);
    assert.equal(query.outputKind, 'EXPANDED');
    assert.equal(runtime.CHESS_RULES_VERSION, 'chess.js@0.10.3');
    assert.equal(query.rulesVersion, runtime.CHESS_RULES_VERSION);

    assert.equal(runtime.PCA_PROPOSAL_KIND.HEURISTIC, 'HEURISTIC');
    assert.equal(runtime.PCA_FAILURE_REASON.DESCRIPTOR_COLLISION, 'DESCRIPTOR_COLLISION');
    assert.notEqual(runtime.PCA_FAILURE_REASON.EXACT_FALLBACK_REQUIRED, 'UNRESOLVED');

    const proposal = runtime.pcaCreateTelescopicProposal({
        proposalId: 'p1',
        kind: runtime.PCA_PROPOSAL_KIND.HEURISTIC,
        queryRef: query,
        sourceStateIdentity: uniqueMateFen,
        horizon: query.horizon
    });
    assert.equal(proposal.evidenceLevel, 'PROPOSED');
    assert.equal(proposal.kind, 'HEURISTIC');

    const noPolicy = runtime.pcaCreateNoTelescopicPolicy();
    const noProposals = noPolicy.propose({});
    assert.ok(Array.isArray(noProposals));
    assert.equal(noProposals.length, 0);
});

test('Query.rulesVersion identifica la versión efectiva de Chess.js', () => {
    const runtime = loadRuntime();
    assert.equal(runtime.CHESS_RULES_VERSION, 'chess.js@0.10.3');
    const defaultQuery = runtime.pcaCreateQuery();
    assert.equal(defaultQuery.rulesVersion, 'chess.js@0.10.3');
    assert.equal(defaultQuery.rulesVersion, runtime.CHESS_RULES_VERSION);
    const overridden = runtime.pcaCreateQuery({ rulesVersion: 'custom-rules' });
    assert.equal(overridden.rulesVersion, 'custom-rules');
    // Single source: constant is the default path for pcaCreateQuery.
    assert.match(runtime.CHESS_RULES_VERSION, /^chess\.js@/);
});

test('A: telescopic disabled == BASELINE PCA', () => {
    const runtime = loadRuntime();
    const fixtures = [
        { fen: uniqueMateFen, k: 2, label: 'mate único' },
        { fen: multiMateFen, k: 6, label: 'mate múltiple', canonical: true },
        { fen: multiMateInOneFen, k: 2, label: 'mate múltiple en 1' },
        { fen: defendedFen, k: 2, label: 'posición defendida / UNRESOLVED' }
    ];

    for (const fixture of fixtures) {
        const baseline = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true
        });
        const disabled = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true,
            telescopicPolicy: 'disabled'
        });
        const omitted = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true
        });
        const slice = fixture.canonical ? pcaContractualExactSliceCanonical : pcaContractualExactSlice;

        assert.deepEqual(slice(disabled), slice(baseline), fixture.label);
        assert.deepEqual(slice(omitted), slice(baseline), fixture.label);
        assert.equal(disabled.nodes, baseline.nodes, fixture.label + ' nodes');
        assert.equal(disabled.telescopicMode, 'disabled');
        assert.equal(disabled.proposalCount, 0);
        assert.equal(disabled.shadowInvocations, 0);
        assert.ok(Array.isArray(disabled.proposalKinds));
        assert.equal(disabled.proposalKinds.length, 0);
    }
});

test('B: telescopic shadow == disabled para resultado exacto', () => {
    const runtime = loadRuntime();
    const fixtures = [
        { fen: uniqueMateFen, k: 2, label: 'mate único' },
        { fen: multiMateFen, k: 6, label: 'mate múltiple', canonical: true },
        { fen: multiMateInOneFen, k: 2, label: 'mate múltiple en 1' },
        { fen: defendedFen, k: 2, label: 'posición defendida / UNRESOLVED' }
    ];

    for (const fixture of fixtures) {
        const baseline = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true
        });
        const disabled = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true,
            telescopicPolicy: 'disabled'
        });
        const shadow = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true,
            telescopicPolicy: 'shadow'
        });
        const slice = fixture.canonical ? pcaContractualExactSliceCanonical : pcaContractualExactSlice;

        assert.deepEqual(slice(disabled), slice(baseline), fixture.label + ' disabled==baseline');
        assert.deepEqual(slice(shadow), slice(disabled), fixture.label + ' shadow==disabled');
        assert.equal(disabled.nodes, baseline.nodes, fixture.label + ' disabled.nodes');
        assert.equal(shadow.nodes, disabled.nodes, fixture.label + ' shadow.nodes');
        assert.equal(shadow.telescopicMode, 'shadow');
        assert.ok(shadow.shadowInvocations >= 1);
        assert.equal(shadow.proposalCount, 0);
    }
});

test('C: ShadowTelescopicPolicy HEURISTIC no altera el resultado exacto', () => {
    const runtime = loadRuntime();
    const baseline = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        semanticOrdering: true,
        telescopicPolicy: 'disabled'
    });
    const heuristicPolicy = runtime.pcaCreateShadowTelescopicPolicy({
        propose: (ctx) => ([
            runtime.pcaCreateTelescopicProposal({
                proposalId: 'shadow-heuristic-1',
                kind: runtime.PCA_PROPOSAL_KIND.HEURISTIC,
                queryRef: ctx.query,
                sourceStateIdentity: ctx.stateIdentity,
                descriptorRef: ctx.descriptorClass,
                horizon: ctx.query && ctx.query.horizon,
                target: ctx.candidateIdentities[0] || null,
                estimatedContraction: 0.5
            })
        ])
    });

    const shadow = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        semanticOrdering: true,
        telescopicPolicy: heuristicPolicy
    });

    assert.deepEqual(pcaBaselineExactSlice(shadow), pcaBaselineExactSlice(baseline));
    assert.equal(shadow.nodes, baseline.nodes);
    assert.equal(shadow.telescopicMode, 'shadow');
    assert.ok(shadow.shadowInvocations >= 1);
    assert.ok(shadow.proposalCount >= 1);
    assert.ok(shadow.proposalKinds.includes('HEURISTIC'));
});

test('D: política shadow maliciosa no modifica candidatos, exactCache ni resultado', () => {
    const runtime = loadRuntime();
    const baseline = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        telescopicPolicy: 'disabled'
    });

    const originalCandidates = ['keep-a', 'keep-b'];
    const candidatesForPolicy = originalCandidates.slice();
    const fakeExactCache = new Map([['poison', true]]);
    const fakeClassCache = new Map([['poison-class', { total: 1 }]]);
    const fakeCollisionMap = new Map();

    let sawFrozenContext = false;
    let contextCandidateCountAfterMutation = -1;
    let contextDepthAfterMutation = null;
    const malicious = runtime.pcaCreateShadowTelescopicPolicy({
        propose: (ctx) => {
            sawFrozenContext = Object.isFrozen(ctx) && Object.isFrozen(ctx.candidateIdentities);
            // Attempt direct mutation of received context / smuggled refs.
            // Non-strict freeze may swallow throws; assert no effective mutation.
            try { ctx.candidateIdentities.push('EVIL'); } catch (_) { /* optional throw */ }
            try { ctx.depth = -999; } catch (_) { /* optional throw */ }
            contextCandidateCountAfterMutation = ctx.candidateIdentities.length;
            contextDepthAfterMutation = ctx.depth;
            try {
                candidatesForPolicy.length = 0;
                candidatesForPolicy.push('MUTATED');
            } catch (_) { /* ignore */ }
            try {
                fakeExactCache.clear();
                fakeExactCache.set('hijacked', false);
                fakeClassCache.clear();
                fakeCollisionMap.set('x', 1);
            } catch (_) { /* ignore */ }
            return [{
                proposalId: 'evil',
                kind: runtime.PCA_PROPOSAL_KIND.HEURISTIC,
                // Smuggle mutable engine refs through proposal payload (must be ignored by solver).
                exactCache: fakeExactCache,
                classCache: fakeClassCache,
                collisionMap: fakeCollisionMap,
                candidates: candidatesForPolicy
            }];
        }
    });

    // Observe seam itself never receives engine mutable maps.
    const observation = runtime.pcaObserveTelescopicContext({
        query: runtime.pcaCreateQuery({ horizonValue: 2 }),
        stateIdentity: uniqueMateFen,
        descriptor: runtime.describeFEN(uniqueMateFen),
        depth: 1,
        candidateIdentities: originalCandidates.slice(),
        hypothesesBefore: 2,
        hypothesesAfter: 1,
        informationGain: 1,
        contractionRatio: 0.5,
        descriptorClass: 'test-class'
    }, { telescopicPolicy: malicious });

    assert.equal(sawFrozenContext, true);
    assert.equal(contextCandidateCountAfterMutation, 2);
    assert.equal(contextDepthAfterMutation, 1);
    assert.deepEqual([...originalCandidates], ['keep-a', 'keep-b']);
    assert.equal(observation.proposalCount, 1);
    assert.equal(observation.proposals[0].kind, 'HEURISTIC');
    // Normalized proposal must not carry mutable engine handles as semantic fields.
    assert.equal(observation.proposals[0].exactCache, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(observation.proposals[0], 'exactCache'), false);

    // Policy already trashed its own closed-over cache during observe; engine never held it.
    assert.equal(fakeExactCache.has('poison'), false);
    const shadowResult = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        telescopicPolicy: malicious
    });
    assert.deepEqual(pcaBaselineExactSlice(shadowResult), pcaBaselineExactSlice(baseline));
    assert.equal(shadowResult.nodes, baseline.nodes);
    // Engine exact result stays baseline regardless of malicious proposal payload.
    assert.equal(shadowResult.status, 'DECIDED_UNIQUE');
    assert.equal(shadowResult.move, 'Qg7#');
});

test('E: NPS artificial no altera orden, resultado exacto ni propuestas shadow', () => {
    const runtime = loadRuntime();
    const baseCandidates = [
        { moveIndex: 0, hypothesesAfter: 2, infoGain: 1, classMateRate: 0.1, mateScore: 1, nps: 9999 },
        { moveIndex: 1, hypothesesAfter: 1, infoGain: 3, classMateRate: 0.9, mateScore: 4, nps: 1 }
    ];
    const swappedNps = baseCandidates.map(candidate => ({
        ...candidate,
        nps: candidate.moveIndex === 0 ? 1 : 9999
    }));
    assert.deepEqual(
        runtime.pcaOrderSemanticCandidates(baseCandidates, true).map(c => c.moveIndex),
        runtime.pcaOrderSemanticCandidates(swappedNps, true).map(c => c.moveIndex)
    );

    const proposalsA = [];
    const proposalsB = [];
    const policyA = runtime.pcaCreateShadowTelescopicPolicy({
        propose: (ctx) => {
            proposalsA.push({
                depth: ctx.depth,
                candidates: [...ctx.candidateIdentities],
                hasNps: Object.prototype.hasOwnProperty.call(ctx, 'nps')
            });
            return [runtime.pcaCreateTelescopicProposal({
                proposalId: 'nps-a',
                kind: runtime.PCA_PROPOSAL_KIND.HEURISTIC,
                sourceStateIdentity: ctx.stateIdentity,
                target: ctx.candidateIdentities[0] || null
            })];
        }
    });
    const policyB = runtime.pcaCreateShadowTelescopicPolicy({
        propose: (ctx) => {
            proposalsB.push({
                depth: ctx.depth,
                candidates: [...ctx.candidateIdentities],
                hasNps: Object.prototype.hasOwnProperty.call(ctx, 'nps')
            });
            return [runtime.pcaCreateTelescopicProposal({
                proposalId: 'nps-b',
                kind: runtime.PCA_PROPOSAL_KIND.HEURISTIC,
                sourceStateIdentity: ctx.stateIdentity,
                target: ctx.candidateIdentities[0] || null
            })];
        }
    });

    const withProgress = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        telescopicPolicy: policyA,
        onProgress: () => {}
    });
    const quiet = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        telescopicPolicy: policyB
    });

    assert.deepEqual(pcaBaselineExactSlice(withProgress), pcaBaselineExactSlice(quiet));
    assert.equal(withProgress.nodes, quiet.nodes);
    assert.deepEqual(withProgress.proposalKinds, quiet.proposalKinds);
    assert.equal(proposalsA.length, proposalsB.length);
    assert.ok(proposalsA.every(sample => sample.hasNps === false));
    assert.ok(proposalsB.every(sample => sample.hasNps === false));
    assert.deepEqual(
        proposalsA.map(sample => sample.candidates),
        proposalsB.map(sample => sample.candidates)
    );
});

test('BASELINE == disabled == shadow en mates múltiples canónicos', () => {
    const runtime = loadRuntime();
    const baseline = runtime.pcaAnalyzePositionCore(multiMateFen, 6, { semanticOrdering: true });
    const disabled = runtime.pcaAnalyzePositionCore(multiMateFen, 6, {
        semanticOrdering: true,
        telescopicPolicy: 'disabled'
    });
    const shadow = runtime.pcaAnalyzePositionCore(multiMateFen, 6, {
        semanticOrdering: true,
        telescopicPolicy: runtime.pcaCreateShadowTelescopicPolicy({
            propose: () => ([
                runtime.pcaCreateTelescopicProposal({
                    proposalId: 'multi-shadow',
                    kind: runtime.PCA_PROPOSAL_KIND.HEURISTIC
                })
            ])
        })
    });

    assert.deepEqual(
        pcaContractualExactSliceCanonical(baseline),
        pcaContractualExactSliceCanonical(disabled)
    );
    assert.deepEqual(
        pcaContractualExactSliceCanonical(disabled),
        pcaContractualExactSliceCanonical(shadow)
    );
    assert.equal(baseline.nodes, disabled.nodes);
    assert.equal(disabled.nodes, shadow.nodes);
    assert.equal(shadow.telescopicMode, 'shadow');
    assert.ok(shadow.proposalCount >= 1);
});

// ---------------------------------------------------------------------------
// Recursive SHADOW seam inside pcaCanForceMate (still observation-only)
// ---------------------------------------------------------------------------

test('A-rec: shadow recursivo realmente observa nodos internos AND/OR', () => {
    const runtime = loadRuntime();
    // multiMateFen requires depth-5 search → root + internal pcaCanForceMate nodes.
    let rootOnlyInvocations = 0;
    const rootCounter = runtime.pcaCreateShadowTelescopicPolicy({
        propose: (ctx) => {
            // Root observations use horizon.value == remaining search k and no remainingPlies
            // field set only on recursive seam. Count by remainingPlies presence.
            if (ctx.remainingPlies == null) rootOnlyInvocations += 1;
            return [];
        }
    });

    const shadow = runtime.pcaAnalyzePositionCore(multiMateFen, 6, {
        semanticOrdering: true,
        telescopicPolicy: rootCounter
    });

    let internalInvocations = 0;
    let totalSeen = 0;
    const depths = [];
    const probe = runtime.pcaCreateShadowTelescopicPolicy({
        propose: (ctx) => {
            totalSeen += 1;
            depths.push({
                depth: ctx.depth,
                remainingPlies: ctx.remainingPlies,
                attackerTurn: ctx.attackerTurn
            });
            if (ctx.remainingPlies != null) internalInvocations += 1;
            return [];
        }
    });
    const probed = runtime.pcaAnalyzePositionCore(multiMateFen, 6, {
        semanticOrdering: true,
        telescopicPolicy: probe
    });

    assert.equal(probed.telescopicMode, 'shadow');
    assert.ok(probed.shadowInvocations >= 1);
    assert.equal(probed.shadowInvocations, totalSeen);
    // Must observe at least one internal AND/OR node beyond pure root observations.
    assert.ok(
        internalInvocations > 0,
        'expected internal recursive shadow observations'
    );
    assert.ok(
        probed.shadowInvocations > internalInvocations
            ? probed.shadowInvocations > internalInvocations
            : probed.shadowInvocations > rootOnlyInvocations || internalInvocations >= 1,
        'shadowInvocations must exceed pure-root-only count or include internals'
    );
    assert.ok(
        probed.shadowInvocations > rootOnlyInvocations || internalInvocations >= 1
    );
    // Stronger: total shadow invocations with recursion > root-loop k iterations alone.
    // multiMate finds at depth 5 → root observes k=1..5 (5 times) plus internals.
    assert.ok(
        probed.shadowInvocations > 5,
        'expected recursive observations beyond root k=1..5 loop'
    );
    assert.ok(depths.some(sample => sample.remainingPlies != null));
    assert.ok(depths.some(sample => sample.attackerTurn === true || sample.attackerTurn === false));
});

test('B-rec: shadow recursivo sigue siendo inocuo (disabled == shadow)', () => {
    const runtime = loadRuntime();
    const fixture = { fen: multiMateFen, k: 6 };

    const disabled = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
        semanticOrdering: true,
        telescopicPolicy: 'disabled'
    });
    const shadow = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
        semanticOrdering: true,
        telescopicPolicy: 'shadow'
    });

    assert.deepEqual(
        pcaContractualExactSliceCanonical(shadow),
        pcaContractualExactSliceCanonical(disabled)
    );
    assert.equal(shadow.nodes, disabled.nodes);
    assert.equal(shadow.status, disabled.status);
    assert.equal(shadow.move, disabled.move);
    assert.equal(shadow.depth, disabled.depth);
    assert.equal(shadow.stopReason, disabled.stopReason);
    assert.equal(shadow.survivors, disabled.survivors);
    assert.deepEqual(
        [...(shadow.forcedMateTargets || [])].sort(),
        [...(disabled.forcedMateTargets || [])].sort()
    );
    assert.ok(shadow.shadowInvocations > 5);
    assert.equal(disabled.shadowInvocations, 0);
});

test('C-rec: política maliciosa en recursión no muta búsqueda ni resultado', () => {
    const runtime = loadRuntime();
    const baseline = runtime.pcaAnalyzePositionCore(multiMateFen, 6, {
        semanticOrdering: true,
        telescopicPolicy: 'disabled'
    });

    const originalCandidates = ['keep-a', 'keep-b'];
    const candidatesForPolicy = originalCandidates.slice();
    const fakeExactCache = new Map([['poison', true]]);
    const fakeClassCache = new Map([['poison-class', { total: 1 }]]);
    const fakeCollisionMap = new Map();
    const fakeGame = { fen: () => 'hijacked' };

    let internalHits = 0;
    let sawFrozen = 0;
    let sawMutableEngineKeys = 0;
    const seenCandidateSnapshots = [];

    const malicious = runtime.pcaCreateShadowTelescopicPolicy({
        propose: (ctx) => {
            if (ctx.remainingPlies != null) internalHits += 1;
            if (Object.isFrozen(ctx) && Object.isFrozen(ctx.candidateIdentities)) {
                sawFrozen += 1;
            }
            // Context must never expose mutable engine handles.
            const forbidden = [
                'orderedCandidates',
                'exactCache',
                'classCache',
                'collisionMap',
                'game',
                'descriptorCache'
            ];
            for (const key of forbidden) {
                if (Object.prototype.hasOwnProperty.call(ctx, key) && ctx[key] != null) {
                    sawMutableEngineKeys += 1;
                }
            }
            seenCandidateSnapshots.push([...(ctx.candidateIdentities || [])]);
            try { ctx.candidateIdentities.push('EVIL'); } catch (_) { /* optional */ }
            try { ctx.depth = -999; } catch (_) { /* optional */ }
            try { ctx.remainingPlies = -1; } catch (_) { /* optional */ }
            try { ctx.attackerTurn = !ctx.attackerTurn; } catch (_) { /* optional */ }
            try {
                candidatesForPolicy.length = 0;
                candidatesForPolicy.push('MUTATED');
                fakeExactCache.clear();
                fakeExactCache.set('hijacked', false);
                fakeClassCache.clear();
                fakeCollisionMap.set('x', 1);
                fakeGame.fen = () => 'mutated';
            } catch (_) { /* ignore */ }
            return [{
                proposalId: 'evil-rec',
                kind: runtime.PCA_PROPOSAL_KIND.HEURISTIC,
                exactCache: fakeExactCache,
                classCache: fakeClassCache,
                collisionMap: fakeCollisionMap,
                orderedCandidates: candidatesForPolicy,
                game: fakeGame
            }];
        }
    });

    const shadow = runtime.pcaAnalyzePositionCore(multiMateFen, 6, {
        semanticOrdering: true,
        telescopicPolicy: malicious
    });

    assert.ok(internalHits >= 1, 'malicious policy must be invoked from internal nodes');
    assert.equal(sawFrozen, shadow.shadowInvocations);
    assert.equal(sawMutableEngineKeys, 0);
    assert.deepEqual(
        pcaContractualExactSliceCanonical(shadow),
        pcaContractualExactSliceCanonical(baseline)
    );
    assert.equal(shadow.nodes, baseline.nodes);
    assert.equal(shadow.status, baseline.status);
    assert.equal(shadow.depth, baseline.depth);
    // Normalized proposals never retain engine handles.
    assert.ok(shadow.proposalCount >= 1);
    assert.equal(shadow.proposals, undefined); // result telemetry does not expose raw proposals array by contract
    // Closed-over mutation did not leak into solver: baseline equality already proves order/result.
    assert.deepEqual(
        [...(shadow.forcedMateTargets || [])].sort(),
        [...(baseline.forcedMateTargets || [])].sort()
    );
    // Candidate identity views observed are plain SAN strings, not mutable move objects.
    assert.ok(seenCandidateSnapshots.every(list => list.every(id => typeof id === 'string')));
});

test('D-rec: contexto telescópico recursivo no contiene NPS/tiempo/DOM/Stockfish', () => {
    const runtime = loadRuntime();
    const forbiddenKeys = [
        'nps',
        'elapsedMs',
        'performance',
        'DOM',
        'dom',
        'document',
        'window',
        'Stockfish',
        'stockfish',
        'worker'
    ];
    const samples = [];
    const policy = runtime.pcaCreateShadowTelescopicPolicy({
        propose: (ctx) => {
            samples.push(ctx);
            return [];
        }
    });

    const result = runtime.pcaAnalyzePositionCore(multiMateFen, 6, {
        semanticOrdering: true,
        telescopicPolicy: policy,
        onProgress: () => {}
    });

    assert.ok(result.shadowInvocations >= 1);
    assert.ok(samples.some(ctx => ctx.remainingPlies != null), 'need recursive samples');
    for (const ctx of samples) {
        assert.equal(Object.isFrozen(ctx), true);
        for (const key of forbiddenKeys) {
            assert.equal(
                Object.prototype.hasOwnProperty.call(ctx, key),
                false,
                'forbidden key present: ' + key
            );
            assert.equal(ctx[key], undefined, 'forbidden value present: ' + key);
        }
        // Required semantic fields remain available on recursive observations.
        if (ctx.remainingPlies != null) {
            assert.ok(ctx.stateIdentity != null);
            assert.ok(ctx.depth != null);
            assert.ok(Array.isArray(ctx.candidateIdentities));
            assert.ok(ctx.query == null || ctx.query.rulesVersion === runtime.CHESS_RULES_VERSION);
        }
    }
});

// ---------------------------------------------------------------------------
// FASE 2 — telescopic ACTIVE mode (permutation-only authority)
// RESULT(BASELINE) == RESULT(DISABLED) == RESULT(SHADOW) == RESULT(ACTIVE)
// nodes may differ under ACTIVE; exact truth must not.
// ---------------------------------------------------------------------------

function pcaExactTruthSlice(result) {
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

function pcaMultisetEqual(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    const counts = new Map();
    for (const item of left) {
        const key = item == null ? null : String(item);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const item of right) {
        const key = item == null ? null : String(item);
        const next = (counts.get(key) || 0) - 1;
        if (next < 0) return false;
        counts.set(key, next);
    }
    for (const value of counts.values()) {
        if (value !== 0) return false;
    }
    return true;
}

test('FASE2 contratos active mode + ActiveTelescopicPolicy existen', () => {
    const runtime = loadRuntime();
    assert.equal(runtime.PCA_TELESCOPIC_MODE.ACTIVE, 'active');
    assert.equal(typeof runtime.pcaCreateActiveTelescopicPolicy, 'function');
    assert.equal(typeof runtime.pcaValidatePermutation, 'function');
    assert.equal(typeof runtime.pcaDefaultActiveRank, 'function');
    assert.equal(typeof runtime.pcaApplyActiveTelescopicRanking, 'function');

    const policy = runtime.pcaCreateActiveTelescopicPolicy();
    assert.equal(policy.mode, 'active');
    assert.equal(typeof policy.propose, 'function');
    assert.equal(typeof policy.rank, 'function');
    const proposals = policy.propose({ candidateIdentities: ['a'] });
    assert.ok(Array.isArray(proposals));
    assert.equal(proposals.length, 0);
});

test('A-active: active es una permutación del universo semántico', () => {
    const runtime = loadRuntime();
    const baseCandidates = [
        { moveIndex: 0, hypothesesAfter: 2, infoGain: 1, classMateRate: 0.1, mateScore: 1, contractionRatio: 0.2 },
        { moveIndex: 1, hypothesesAfter: 1, infoGain: 3, classMateRate: 0.9, mateScore: 4, contractionRatio: 0.8 },
        { moveIndex: 2, hypothesesAfter: 3, infoGain: 0, classMateRate: 0.0, mateScore: 0, contractionRatio: 0.1 }
    ];
    const semantic = runtime.pcaOrderSemanticCandidates(baseCandidates, true);
    const semanticIds = semantic.map(candidate => String(candidate.moveIndex));

    const context = runtime.pcaBuildTelescopicContext({
        attackerTurn: true,
        candidateIdentities: semanticIds,
        candidateViews: semantic.map(candidate => ({
            identity: String(candidate.moveIndex),
            moveIndex: candidate.moveIndex,
            hypothesesAfter: candidate.hypothesesAfter,
            informationGain: candidate.infoGain,
            contractionRatio: candidate.contractionRatio,
            classMateRate: candidate.classMateRate,
            mateScore: candidate.mateScore
        }))
    });
    const ranked = runtime.pcaDefaultActiveRank(context, semanticIds.slice());
    assert.equal(ranked.length, semanticIds.length);
    assert.equal(new Set(ranked).size, ranked.length);
    assert.equal(pcaMultisetEqual(ranked, semanticIds), true);

    const validation = runtime.pcaValidatePermutation(semanticIds, ranked);
    assert.equal(validation.ok, true);

    // Live solver: capture root/internal candidate universes under reverse-rank policy.
    const observed = [];
    const reversePolicy = runtime.pcaCreateActiveTelescopicPolicy({
        rank: (ctx, ids) => ids.slice().reverse()
    });
    const active = runtime.pcaAnalyzePositionCore(multiMateFen, 6, {
        semanticOrdering: true,
        telescopicPolicy: reversePolicy
    });
    assert.equal(active.telescopicMode, 'active');
    assert.ok(active.activeInvocations >= 1);
    assert.ok(active.reordersApplied >= 1);

    // Direct apply path must preserve candidate object multiset.
    const fakeMoves = ['Aa', 'Bb', 'Cc'].map((san, moveIndex) => ({
        move: { san },
        moveIndex,
        hypothesesAfter: moveIndex,
        infoGain: 3 - moveIndex,
        contractionRatio: 0.1 * moveIndex,
        classMateRate: 0.2 * moveIndex,
        mateScore: moveIndex
    }));
    const telemetry = {
        activeInvocations: 0,
        reordersApplied: 0,
        reordersRejected: 0,
        orderFallbacks: 0,
        rootReorders: 0,
        internalReorders: 0,
        proposalCount: 0,
        proposalKinds: [],
        proposals: []
    };
    const reordered = runtime.pcaApplyActiveTelescopicRanking(
        fakeMoves,
        { attackerTurn: true, depth: 2 },
        { telescopicPolicy: reversePolicy },
        telemetry,
        'root'
    );
    assert.equal(reordered.length, fakeMoves.length);
    const reorderedSans = reordered.map(c => c.move.san);
    const baseSans = fakeMoves.map(c => c.move.san);
    assert.equal(pcaMultisetEqual(reorderedSans, baseSans), true);
    assert.equal(reorderedSans.join(','), 'Cc,Bb,Aa');
    assert.equal(telemetry.reordersApplied, 1);
    assert.equal(telemetry.rootReorders, 1);
});

test('B-active: política inválida falla cerrada y preserva resultado exacto', () => {
    const runtime = loadRuntime();
    const disabled = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        semanticOrdering: true,
        telescopicPolicy: 'disabled'
    });

    const cases = [
        {
            label: 'elimina candidato',
            rank: (ctx, ids) => ids.slice(0, Math.max(0, ids.length - 1))
        },
        {
            label: 'duplica candidato',
            rank: (ctx, ids) => (ids.length ? ids.slice(0, -1).concat([ids[0]]) : ids)
        },
        {
            label: 'inventa candidato',
            rank: (ctx, ids) => ids.map((id, index) => (index === 0 ? 'ZZ_FAKE' : id))
        },
        {
            label: 'devuelve null',
            rank: () => null
        },
        {
            label: 'devuelve undefined',
            rank: () => undefined
        },
        {
            label: 'lanza excepción',
            rank: () => {
                throw new Error('boom-policy');
            }
        }
    ];

    for (const scenario of cases) {
        const policy = runtime.pcaCreateActiveTelescopicPolicy({
            rank: scenario.rank
        });
        const active = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
            semanticOrdering: true,
            telescopicPolicy: policy
        });
        assert.deepEqual(
            pcaExactTruthSlice(active),
            pcaExactTruthSlice(disabled),
            scenario.label
        );
        assert.equal(active.telescopicMode, 'active', scenario.label);
        assert.ok(active.activeInvocations >= 1, scenario.label);
        assert.ok(active.orderFallbacks >= 1, scenario.label + ' fallback');
        assert.ok(active.reordersRejected >= 1, scenario.label + ' rejected');
        assert.equal(active.reordersApplied, 0, scenario.label + ' no apply');
    }

    // Unit-level validatePermutation coverage.
    assert.equal(runtime.pcaValidatePermutation(['a', 'b'], ['a']).ok, false);
    assert.equal(runtime.pcaValidatePermutation(['a', 'b'], ['a', 'a']).ok, false);
    assert.equal(runtime.pcaValidatePermutation(['a', 'b'], ['a', 'c']).ok, false);
    assert.equal(runtime.pcaValidatePermutation(['a', 'b'], null).ok, false);
    assert.equal(runtime.pcaValidatePermutation(['a', 'b'], ['b', 'a']).ok, true);
});

test('C-active: resultado exacto conserva verdad disabled == active', () => {
    const runtime = loadRuntime();
    const fixtures = [
        { fen: uniqueMateFen, k: 2, label: 'mate único' },
        { fen: multiMateFen, k: 6, label: 'mate múltiple' },
        { fen: multiMateInOneFen, k: 2, label: 'mate múltiple en 1' },
        { fen: defendedFen, k: 2, label: 'posición defendida / UNRESOLVED' }
    ];

    for (const fixture of fixtures) {
        const disabled = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true,
            telescopicPolicy: 'disabled'
        });
        const shadow = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true,
            telescopicPolicy: 'shadow'
        });
        const active = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true,
            telescopicPolicy: 'active'
        });
        const reverse = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true,
            telescopicPolicy: runtime.pcaCreateActiveTelescopicPolicy({
                rank: (ctx, ids) => ids.slice().reverse()
            })
        });

        assert.deepEqual(
            pcaExactTruthSlice(active),
            pcaExactTruthSlice(disabled),
            fixture.label + ' active'
        );
        assert.deepEqual(
            pcaExactTruthSlice(shadow),
            pcaExactTruthSlice(disabled),
            fixture.label + ' shadow'
        );
        assert.deepEqual(
            pcaExactTruthSlice(reverse),
            pcaExactTruthSlice(disabled),
            fixture.label + ' reverse-active'
        );
        assert.equal(active.telescopicMode, 'active', fixture.label);
        assert.equal(shadow.nodes, disabled.nodes, fixture.label + ' shadow nodes');
    }
});

test('D-active: ACTIVE reordena root e internos AND/OR', () => {
    const runtime = loadRuntime();
    let rootRanks = 0;
    let internalRanks = 0;
    const policy = runtime.pcaCreateActiveTelescopicPolicy({
        rank: (ctx, ids) => {
            if (ctx.remainingPlies != null) internalRanks += 1;
            else rootRanks += 1;
            return ids.slice().reverse();
        }
    });
    const active = runtime.pcaAnalyzePositionCore(multiMateFen, 6, {
        semanticOrdering: true,
        telescopicPolicy: policy
    });

    assert.equal(active.telescopicMode, 'active');
    assert.ok(active.activeInvocations >= 1);
    assert.ok(rootRanks >= 1, 'expected root active ranking');
    assert.ok(internalRanks >= 1, 'expected internal AND/OR active ranking');
    assert.ok(active.rootReorders >= 1, 'expected rootReorders telemetry');
    assert.ok(active.internalReorders >= 1, 'expected internalReorders telemetry');
    assert.equal(active.activeInvocations, rootRanks + internalRanks);
});

test('E-active: NPS artificial no altera ranking telescópico activo', () => {
    const runtime = loadRuntime();
    const identities = ['m0', 'm1', 'm2'];
    const viewsA = [
        { identity: 'm0', moveIndex: 0, hypothesesAfter: 2, informationGain: 1, contractionRatio: 0.2, classMateRate: 0.1, mateScore: 1, nps: 9999 },
        { identity: 'm1', moveIndex: 1, hypothesesAfter: 1, informationGain: 3, contractionRatio: 0.8, classMateRate: 0.9, mateScore: 4, nps: 1 },
        { identity: 'm2', moveIndex: 2, hypothesesAfter: 0, informationGain: 0, contractionRatio: 0.0, classMateRate: 0.0, mateScore: 0, nps: 500 }
    ];
    const viewsB = viewsA.map(view => Object.assign({}, view, {
        nps: view.nps === 9999 ? 1 : view.nps === 1 ? 9999 : 42
    }));

    const ctxA = runtime.pcaBuildTelescopicContext({
        attackerTurn: true,
        candidateIdentities: identities,
        candidateViews: viewsA
    });
    const ctxB = runtime.pcaBuildTelescopicContext({
        attackerTurn: true,
        candidateIdentities: identities,
        candidateViews: viewsB
    });

    assert.equal(Object.prototype.hasOwnProperty.call(ctxA, 'nps'), false);
    assert.ok(ctxA.candidateViews.every(view => !Object.prototype.hasOwnProperty.call(view, 'nps')));
    assert.deepEqual(
        runtime.pcaDefaultActiveRank(ctxA, identities.slice()),
        runtime.pcaDefaultActiveRank(ctxB, identities.slice())
    );

    const samples = [];
    const policy = runtime.pcaCreateActiveTelescopicPolicy({
        rank: (ctx, ids) => {
            samples.push(ctx);
            return ids.slice().reverse();
        }
    });
    const withProgress = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        semanticOrdering: true,
        telescopicPolicy: policy,
        onProgress: () => {}
    });
    const quiet = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        semanticOrdering: true,
        telescopicPolicy: 'active'
    });

    assert.deepEqual(pcaExactTruthSlice(withProgress), pcaExactTruthSlice(quiet));
    assert.ok(samples.length >= 1);
    for (const ctx of samples) {
        assert.equal(Object.prototype.hasOwnProperty.call(ctx, 'nps'), false);
        assert.equal(ctx.nps, undefined);
        assert.equal(Object.prototype.hasOwnProperty.call(ctx, 'elapsedMs'), false);
        assert.ok(Array.isArray(ctx.candidateViews));
        assert.ok(ctx.candidateViews.every(view => !Object.prototype.hasOwnProperty.call(view, 'nps')));
    }
});

test('F-active: experimento causal nodes disabled vs active', () => {
    const runtime = loadRuntime();
    const fixtures = [
        { fen: uniqueMateFen, k: 2, label: 'mate único' },
        { fen: multiMateInOneFen, k: 2, label: 'mate múltiple en 1' },
        { fen: multiMateFen, k: 6, label: 'mate múltiple' },
        { fen: defendedFen, k: 2, label: 'defendida' }
    ];

    const report = [];
    let foundDelta = false;
    for (const fixture of fixtures) {
        const disabled = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true,
            telescopicPolicy: 'disabled'
        });
        const shadow = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true,
            telescopicPolicy: 'shadow'
        });
        const activeDefault = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true,
            telescopicPolicy: 'active'
        });
        const activeReverse = runtime.pcaAnalyzePositionCore(fixture.fen, fixture.k, {
            semanticOrdering: true,
            telescopicPolicy: runtime.pcaCreateActiveTelescopicPolicy({
                rank: (ctx, ids) => ids.slice().reverse()
            })
        });

        assert.deepEqual(pcaExactTruthSlice(activeDefault), pcaExactTruthSlice(disabled));
        assert.deepEqual(pcaExactTruthSlice(activeReverse), pcaExactTruthSlice(disabled));
        assert.equal(shadow.nodes, disabled.nodes);

        const row = {
            label: fixture.label,
            disabledNodes: disabled.nodes,
            shadowNodes: shadow.nodes,
            activeDefaultNodes: activeDefault.nodes,
            activeReverseNodes: activeReverse.nodes,
            activeInvocations: activeReverse.activeInvocations,
            reordersApplied: activeReverse.reordersApplied,
            rootReorders: activeReverse.rootReorders,
            internalReorders: activeReverse.internalReorders
        };
        report.push(row);
        if (activeDefault.nodes !== disabled.nodes || activeReverse.nodes !== disabled.nodes) {
            foundDelta = true;
        }
    }

    // Experimental note only — do not fabricate fixtures solely to force a delta.
    if (!foundDelta) {
        console.log('FASE2 causal experiment: no node delta on existing fixtures');
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log('FASE2 causal experiment: node delta observed');
        console.log(JSON.stringify(report, null, 2));
    }
    assert.ok(report.length >= 1);
    assert.ok(report.every(row => row.activeInvocations >= 1));
});

test('FASE2 active no usa NPS y shadow/disabled siguen intactos', () => {
    const runtime = loadRuntime();
    const baseline = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        semanticOrdering: true
    });
    const disabled = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        semanticOrdering: true,
        telescopicPolicy: 'disabled'
    });
    const shadow = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        semanticOrdering: true,
        telescopicPolicy: 'shadow'
    });
    const active = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {
        semanticOrdering: true,
        telescopicPolicy: 'active'
    });

    assert.deepEqual(pcaExactTruthSlice(disabled), pcaExactTruthSlice(baseline));
    assert.deepEqual(pcaExactTruthSlice(shadow), pcaExactTruthSlice(baseline));
    assert.deepEqual(pcaExactTruthSlice(active), pcaExactTruthSlice(baseline));
    assert.equal(disabled.nodes, baseline.nodes);
    assert.equal(shadow.nodes, baseline.nodes);
    assert.equal(disabled.activeInvocations, 0);
    assert.equal(shadow.activeInvocations, 0);
    assert.ok(active.activeInvocations >= 1);
    assert.equal(active.shadowInvocations, 0);
});
