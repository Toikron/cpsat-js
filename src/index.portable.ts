/**
 * Portable entry point — the default in browsers and any unrecognised runtime.
 *
 * Uses the single-threaded WASM build. It does not need `SharedArrayBuffer`, so it
 * works without cross-origin isolation, in Deno/Bun/edge runtimes, and from a plain
 * CDN `<script type="module">`.
 *
 * `numWorkers` is forced to 1 here. CP-SAT selects its subsolver portfolio by worker
 * count and 2 or 4 workers are measurably SLOWER than 1, so clamping to anything
 * other than 1 would be a performance bug.
 */
import { setGlueLoader, makeGlueLoader } from './solver/cp-solver.js';

setGlueLoader(
  makeGlueLoader(
    // @ts-expect-error Emscripten-generated ESM glue; no TS declarations.
    () => import('../build/portable/cpsat.mjs'),
    () => new URL('../build/portable/cpsat.wasm', import.meta.url).href,
  ),
  false,
);

export * from './index.js';
