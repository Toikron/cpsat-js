/**
 * Threaded entry point — the default in Node.
 *
 * Uses the pthreads WASM build, which runs CP-SAT's parallel subsolver portfolio and
 * is ~15x faster than the portable build. Requires `SharedArrayBuffer`: always
 * available in Node, but in browsers only under cross-origin isolation (COOP
 * `same-origin` + COEP `require-corp`). Without it the module fails at init, so
 * browsers resolve to './index.portable.js' via the "browser" export condition.
 *
 * The literal import paths below are what let a bundler emit exactly one WASM asset.
 */
import { setGlueLoader, makeGlueLoader } from './solver/cp-solver.js';

setGlueLoader(
  makeGlueLoader(
    // @ts-expect-error Emscripten-generated ESM glue; no TS declarations.
    () => import('../build/threaded/cpsat.mjs'),
    () => new URL('../build/threaded/cpsat.wasm', import.meta.url).href,
  ),
  true,
);

export * from './index.js';
