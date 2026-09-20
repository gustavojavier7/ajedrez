#!/usr/bin/env node
// Experimento de observabilidad: misma FEN + mismo K en los tres modos telescópicos.
//
//   node tools/pca-telescopic-compare.cjs [FEN] [K]
//
// Camino A: `pcaAnalyzePositionCore(fen, kGuard, { telescopicPolicy })` directo.
// Camino B: UI → Worker real (`pcaCreateWorkerStartMessage` + `pcaCreateWorkerSource`).
//
// Invariante esperado: la verdad exacta (status, move, depth, stopReason,
// conjunto forcedMateTargets y survivors) es idéntica en DISABLED / SHADOW / ACTIVE.
// Nodos, tiempo, orden y trazas pueden diferir.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Chess } = require('chess.js');

const repoRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
if (!scriptMatch) throw new Error('No se encontró el bloque <script> principal en index.html');

function loadRuntime() {
    const context = {
        Chess,
        console,
        performance: { now: () => 0, memory: null },
        MutationObserver: function MutationObserver() {},
        Blob: function Blob() {},
        URL: { createObjectURL: () => 'blob:compare', revokeObjectURL: () => {} },
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

function startWorkerRun(runtime, startMessage) {
    const messages = [];
    const sandbox = {
        self: { onmessage: null, postMessage: message => messages.push(message) },
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
    const from = messages.length;
    sandbox.self.onmessage({ data: startMessage });
    const terminal = messages.slice(from).find(message => message.type === 'RESULT'
        || message.type === 'TRUNCATED'
        || message.type === 'ERROR');
    return terminal ? terminal.pcaResult || null : null;
}

function truth(result) {
    return {
        status: result.status,
        move: result.move,
        depth: result.depth,
        stopReason: result.stopReason,
        forcedMateTargets: [...(result.forcedMateTargets || [])].sort(),
        survivors: result.survivors
    };
}

function observability(result) {
    return {
        nodes: result.nodes,
        telescopicMode: result.telescopicMode,
        activeInvocations: result.activeInvocations,
        reordersApplied: result.reordersApplied,
        reordersRejected: result.reordersRejected,
        orderFallbacks: result.orderFallbacks,
        rootReorders: result.rootReorders,
        internalReorders: result.internalReorders,
        shadowInvocations: result.shadowInvocations,
        proposalCount: result.proposalCount
    };
}

const fen = process.argv[2] || '7k/8/8/4K3/8/8/8/1Q6 w - - 0 1';
const kGuard = Number(process.argv[3] || 5);
const runtime = loadRuntime();

console.log(`FEN: ${fen}`);
console.log(`K  : ${kGuard}`);
console.log('');

const rows = [];
for (const mode of ['disabled', 'shadow', 'active']) {
    const startedAt = Date.now();
    const core = runtime.pcaAnalyzePositionCore(fen, kGuard, { telescopicPolicy: mode });
    const coreMs = Date.now() - startedAt;

    const startedWorkerAt = Date.now();
    const workerResult = startWorkerRun(runtime, runtime.pcaCreateWorkerStartMessage({
        runId: 1,
        fen,
        kGuard,
        telescopicPolicy: mode
    }));
    const workerMs = Date.now() - startedWorkerAt;

    rows.push({
        mode,
        coreMs,
        workerMs,
        core,
        workerResult
    });
}

const reference = truth(rows[0].core);
for (const row of rows) {
    const workerTruth = row.workerResult ? truth(row.workerResult) : null;
    console.log(`[${row.mode.toUpperCase()}]`);
    console.log('  verdad   :', JSON.stringify(truth(row.core)));
    console.log('  verdad == DISABLED :', JSON.stringify(truth(row.core)) === JSON.stringify(reference));
    console.log('  worker == core     :', workerTruth !== null
        && JSON.stringify(workerTruth) === JSON.stringify(truth(row.core)));
    console.log('  observab.:', JSON.stringify(observability(row.core)));
    console.log(`  tiempo   : core ${row.coreMs} ms · worker ${row.workerMs} ms`);
    console.log('');
}
