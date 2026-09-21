# Stockfish.js 19 (single-thread full)

Local vendor copy of **Stockfish.js 19 FULL SINGLE** used by the normal analysis
panel in `index.html`.

## Files

- `stockfish-19-single.js` — worker/loader entry
- `stockfish-19-single.wasm` — companion WASM binary (must sit next to the JS)
- `COPYING.txt` — GPLv3

Source: [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) v19.0.0

## Important: real WASM binary (not Git LFS)

`stockfish-19-single.wasm` is committed as a **normal git blob** (~99 MB), not via
Git LFS. The file must start with the WebAssembly magic bytes `00 61 73 6d`
(`\0asm`).

If a host serves a Git LFS pointer instead (text starting with `version https://git-lfs…`,
bytes `76 65 72 73`), the browser fails with:

```text
WebAssembly.instantiateStreaming(): expected magic word 00 61 73 6d, found 76 65 72 73
```

`index.html` checks the magic before starting the Worker and surfaces a clear error.

Serve this directory over HTTP(S) so both the `.js` and `.wasm` are reachable at the
same origin path. A correct static server should advertise `Content-Type:
application/wasm` (or `application/octet-stream`) for the `.wasm`.

## Loading

Instantiate with a real Worker URL (not a Blob URL), so the loader can resolve
the sibling `.wasm` via the script path:

```js
const engine = new Worker('vendor/stockfish/stockfish-19-single.js');
```

This build is **single-threaded** (no UCI `Threads`). Hash size is left at the
engine default until a later change; the UI only registers the announced range.
