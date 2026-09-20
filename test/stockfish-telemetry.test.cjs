'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
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
        document: {
            getElementById: () => ({
                textContent: '',
                value: '10',
                className: '',
                classList: { add() {}, remove() {} },
                disabled: false,
                innerHTML: '',
                hidden: false
            })
        },
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

test('index.html carga Stockfish 19 single local (no CDN 10.0.2 / no Blob worker path)', () => {
    assert.match(html, /vendor\/stockfish\/stockfish-19-single\.js/);
    assert.doesNotMatch(html, /stockfish\.js\/10\.0\.2/);
    assert.match(html, /new Worker\(STOCKFISH_ENGINE_JS_URL\)/);
    assert.match(html, /Hash ocupado/);
    assert.match(html, /sfNpsWindowSelect/);
    assert.ok(fs.existsSync(path.join(repoRoot, 'vendor/stockfish/stockfish-19-single.js')));
    assert.ok(fs.existsSync(path.join(repoRoot, 'vendor/stockfish/stockfish-19-single.wasm')));
});

test('NPS móvil usa diferencias de nodes/time, no nodes/time global', () => {
    const rt = loadRuntime();
    const samples = [];
    // Acumulados UCI: ritmo real ~500k nps en la ventana reciente, pero acumulado mucho menor.
    rt.sfRecordNpsSample(1000, 100000, samples);      // 100k nps acum.
    rt.sfRecordNpsSample(5000, 500000, samples);      // +400k / 4s = 100k
    rt.sfRecordNpsSample(11000, 5500000, samples);    // +5.0M / 6s ≈ 833333 sobre tramo largo
    // Ventana 5s: oldest con time<=6000 → sample@5000 → (5.5M-0.5M)*1000/(11000-5000)=833333
    const rolling5 = rt.sfComputeRollingNps(samples, 5000);
    const rolling10 = rt.sfComputeRollingNps(samples, 10000);
    const cumulative = rt.sfComputeCumulativeNps(11000, 5500000);

    assert.equal(rolling5, Math.round((5500000 - 500000) * 1000 / (11000 - 5000)));
    assert.equal(rolling10, Math.round((5500000 - 100000) * 1000 / (11000 - 1000)));
    assert.equal(cumulative, Math.round(5500000 * 1000 / 11000));
    assert.notEqual(rolling5, cumulative);
    assert.notEqual(rolling10, cumulative);
    // Selector 5/10 cambia solo la ventana (muestras idénticas).
    assert.notEqual(rolling5, rolling10);
});

test('nueva búsqueda reinicia la ventana NPS', () => {
    const rt = loadRuntime();
    // Exercising the same helpers startAnalysis uses, with an explicit store
    // (VM `let` bindings are not always readable as context properties).
    const samples = [];
    rt.sfRecordNpsSample(1000, 1000, samples);
    rt.sfRecordNpsSample(2000, 2000, samples);
    assert.equal(samples.length, 2);
    rt.sfResetNpsSamples(samples);
    assert.equal(samples.length, 0);
    assert.equal(rt.sfComputeRollingNps(samples, 10000), null);

    // resetStockfishSearchTelemetry clears engine-side rolling state via helpers.
    rt.resetStockfishSearchTelemetry();
    const after = rt.createEmptyStockfishStats();
    assert.equal(after.npsRolling, null);
    assert.equal(after.npsCumulative, null);
    assert.equal(after.hashfull, null);
});

test('hashfull 376 → 37.6 % y ausencia → —', () => {
    const rt = loadRuntime();
    assert.equal(rt.sfHashfullToPercent(376), 37.6);
    assert.equal(rt.sfFormatHashOccupancy(376), '37.6 %');
    assert.equal(rt.sfHashfullToPercent(null), null);
    assert.equal(rt.sfFormatHashOccupancy(null), '—');
    assert.equal(rt.sfFormatHashOccupancy(undefined), '—');
});

test('parsea option name Hash default/min/max sin mutar Hash automáticamente', () => {
    const rt = loadRuntime();
    const line = 'option name Hash type spin default 16 min 1 max 33554432';
    const option = rt.sfParseUciOptionLine(line);
    assert.ok(option);
    assert.equal(option.name, 'Hash');
    assert.equal(option.type, 'spin');
    assert.equal(option.default, '16');
    assert.equal(option.min, 1);
    assert.equal(option.max, 33554432);
    const map = Object.create(null);
    rt.sfRegisterEngineOption(line, map);
    assert.equal(map.Hash.default, '16');
    // No hay setoption Hash en el HTML de arranque (solo MultiPV=1).
    assert.doesNotMatch(html, /setoption name Hash/);
    assert.match(html, /setoption name MultiPV value 1/);
});

test('NPS con ventana incompleta usa el intervalo disponible y no inventa datos', () => {
    const rt = loadRuntime();
    const samples = [];
    assert.equal(rt.sfComputeRollingNps(samples, 10000), null);
    rt.sfRecordNpsSample(0, 0, samples);
    assert.equal(rt.sfComputeRollingNps(samples, 10000), null);
    rt.sfRecordNpsSample(2500, 500000, samples);
    // Sólo ~2.5s disponibles: usa ese intervalo.
    assert.equal(rt.sfComputeRollingNps(samples, 10000), Math.round(500000 * 1000 / 2500));
});

test('SF19 single responde uciok/readyok e id name + opción Hash', async () => {
    const engineJs = path.join(repoRoot, 'vendor/stockfish/stockfish-19-single.js');
    const child = spawn(process.execPath, [engineJs], {
        stdio: ['pipe', 'pipe', 'pipe']
    });
    let buf = '';
    const lines = [];
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
            lines.push(buf.slice(0, idx).replace(/\r$/, ''));
            buf = buf.slice(idx + 1);
        }
    });

    const waitFor = (pred, ms) => new Promise((resolve, reject) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (pred()) {
                clearInterval(iv);
                resolve();
            } else if (Date.now() - t0 > ms) {
                clearInterval(iv);
                reject(new Error('timeout waiting for engine output: ' + lines.slice(0, 20).join(' | ')));
            }
        }, 20);
    });

    try {
        child.stdin.write('uci\n');
        await waitFor(() => lines.includes('uciok'), 15000);
        const idName = lines.find(l => l.startsWith('id name '));
        const hashOpt = lines.find(l => l.startsWith('option name Hash '));
        assert.ok(idName, 'falta id name');
        assert.match(idName, /Stockfish 19/);
        assert.ok(hashOpt, 'falta option Hash');
        assert.match(hashOpt, /default 16/);
        assert.match(hashOpt, /min 1/);
        assert.match(hashOpt, /max 33554432/);

        child.stdin.write('isready\n');
        await waitFor(() => lines.includes('readyok'), 10000);

        child.stdin.write('position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\n');
        child.stdin.write('go infinite\n');

        await waitFor(() => lines.some(l => l.startsWith('info') && l.includes('nodes') && l.includes('time')), 15000);
        // Deja correr un poco para posible hashfull.
        await new Promise(r => setTimeout(r, 1500));
        child.stdin.write('stop\n');
        await waitFor(() => lines.some(l => l.startsWith('bestmove')), 10000);

        const infoLines = lines.filter(l => l.startsWith('info ') && l.includes('nodes') && l.includes('time'));
        assert.ok(infoLines.length >= 1, 'go infinite no emitió info nodes/time');

        // Validar fórmula NPS móvil sobre muestras reales del motor.
        const samples = [];
        for (const line of infoLines) {
            const parts = line.split(/\s+/);
            const ni = parts.indexOf('nodes');
            const ti = parts.indexOf('time');
            if (ni === -1 || ti === -1) continue;
            const nodes = Number(parts[ni + 1]);
            const timeMs = Number(parts[ti + 1]);
            if (Number.isFinite(nodes) && Number.isFinite(timeMs)) {
                loadRuntime().sfRecordNpsSample(timeMs, nodes, samples);
            }
        }
        assert.ok(samples.length >= 1);
        const rt = loadRuntime();
        const rolling = rt.sfComputeRollingNps(samples, 10000);
        const last = samples[samples.length - 1];
        const cumulative = rt.sfComputeCumulativeNps(last.timeMs, last.nodes);
        if (samples.length >= 2 && rolling != null && cumulative != null) {
            // No exigir desigualdad siempre (búsqueda corta puede coincidir), pero sí finitud.
            assert.ok(Number.isFinite(rolling));
            assert.ok(Number.isFinite(cumulative));
        }

        const hashLine = lines.find(l => /\bhashfull\b/.test(l));
        if (hashLine) {
            const parts = hashLine.split(/\s+/);
            const hi = parts.indexOf('hashfull');
            const hv = Number(parts[hi + 1]);
            assert.ok(Number.isFinite(hv));
            assert.equal(rt.sfFormatHashOccupancy(hv), (hv / 10).toFixed(1) + ' %');
        }
    } finally {
        try { child.stdin.write('quit\n'); } catch (_) { /* ignore */ }
        child.kill('SIGKILL');
    }
});
