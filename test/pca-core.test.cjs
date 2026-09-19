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
//   policy disabled == BASELINE PCA
// Comparable fields: status, move, depth, stopReason, survivors, forcedMateTargets.
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

test('A: telescopic disabled == BASELINE PCA', () => {
    const runtime = loadRuntime();
    const fixtures = [
        { fen: uniqueMateFen, k: 2 },
        { fen: multiMateInOneFen, k: 2 },
        { fen: defendedFen, k: 2 }
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

        assert.deepEqual(pcaBaselineExactSlice(disabled), pcaBaselineExactSlice(baseline));
        assert.deepEqual(pcaBaselineExactSlice(omitted), pcaBaselineExactSlice(baseline));
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
        { fen: uniqueMateFen, k: 2 },
        { fen: multiMateInOneFen, k: 2 },
        { fen: defendedFen, k: 2 }
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

        assert.deepEqual(pcaBaselineExactSlice(shadow), pcaBaselineExactSlice(disabled));
        assert.equal(shadow.nodes, disabled.nodes);
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
        pcaBaselineExactSliceCanonical(baseline),
        pcaBaselineExactSliceCanonical(disabled)
    );
    assert.deepEqual(
        pcaBaselineExactSliceCanonical(disabled),
        pcaBaselineExactSliceCanonical(shadow)
    );
    assert.equal(baseline.nodes, disabled.nodes);
    assert.equal(disabled.nodes, shadow.nodes);
    assert.equal(shadow.telescopicMode, 'shadow');
    assert.ok(shadow.proposalCount >= 1);
});
