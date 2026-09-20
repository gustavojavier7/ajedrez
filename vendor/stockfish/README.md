# Stockfish.js 19 (single-thread full)

Local vendor copy of **Stockfish.js 19 FULL SINGLE** used by the normal analysis
panel in `index.html`.

## Files

- `stockfish-19-single.js` — worker/loader entry
- `stockfish-19-single.wasm` — companion WASM (must sit next to the JS)
- `COPYING.txt` — GPLv3

Source: [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) v19.0.0

## Loading

Instantiate with a real Worker URL (not a Blob URL), so the loader can resolve
the sibling `.wasm` via the script path:

```js
const engine = new Worker('vendor/stockfish/stockfish-19-single.js');
```

This build is **single-threaded** (no UCI `Threads`). Hash size is left at the
engine default until a later change; the UI only registers the announced range.
