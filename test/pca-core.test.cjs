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

// Multiple shortest forced mates at depth 1: Qe8# and Qg7#.
const multiMateFen = '6k1/5Q2/6K1/8/8/8/8/8 w - - 0 1';
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

    assert.equal(result.status, 'DECIDED');
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

    assert.equal(result.status, 'DECIDED');
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

test('mates mínimos múltiples no declaran DECIDED y son independientes del orden PCA', () => {
    const runtime = loadRuntime();
    const withPca = runtime.pcaAnalyzePositionCore(multiMateFen, 2, { semanticOrdering: true });
    const withoutPca = runtime.pcaAnalyzePositionCore(multiMateFen, 2, { semanticOrdering: false });

    assert.equal(withPca.status, 'UNRESOLVED');
    assert.equal(withPca.stopReason, 'TIED_SHORTEST_FORCED_MATE');
    assert.equal(withPca.depth, 1);
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

    const game = new Chess(multiMateFen);
    const exactMates = game.moves({ verbose: true })
        .filter(move => {
            const child = new Chess(multiMateFen);
            child.move(move);
            return child.in_checkmate();
        })
        .map(move => move.san)
        .sort();
    assert.deepEqual([...withPca.forcedMateTargets].sort(), exactMates);
    assert.ok(exactMates.length > 1);
});

test('mate mínimo único sigue siendo DECIDED con y sin orden PCA', () => {
    const runtime = loadRuntime();
    const withPca = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, { semanticOrdering: true });
    const withoutPca = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, { semanticOrdering: false });

    assert.equal(withPca.status, 'DECIDED');
    assert.equal(withPca.stopReason, 'FORCED_MATE_CERTIFIED');
    assert.equal(withPca.depth, 1);
    assert.equal(withPca.move, 'Qg7#');
    assert.deepEqual([...withPca.forcedMateTargets], ['Qg7#']);
    assert.equal(withoutPca.status, withPca.status);
    assert.equal(withoutPca.move, withPca.move);
    assert.equal(withoutPca.stopReason, withPca.stopReason);
    assert.deepEqual([...withoutPca.forcedMateTargets], [...withPca.forcedMateTargets]);
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

test('NPS artificial no altera la clasificación exacta DECIDED/TIED', () => {
    const runtime = loadRuntime();
    const samples = [];
    const onProgress = (progress) => {
        samples.push(progress);
    };

    const unique = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, { onProgress });
    const tied = runtime.pcaAnalyzePositionCore(multiMateFen, 2, { onProgress });
    const uniqueQuiet = runtime.pcaAnalyzePositionCore(uniqueMateFen, 2, {});
    const tiedQuiet = runtime.pcaAnalyzePositionCore(multiMateFen, 2, {});

    assert.equal(unique.status, uniqueQuiet.status);
    assert.equal(unique.move, uniqueQuiet.move);
    assert.equal(unique.stopReason, uniqueQuiet.stopReason);
    assert.equal(tied.status, tiedQuiet.status);
    assert.equal(tied.stopReason, tiedQuiet.stopReason);
    assert.deepEqual([...tied.forcedMateTargets].sort(), [...tiedQuiet.forcedMateTargets].sort());
    assert.ok(samples.length > 0);
});
