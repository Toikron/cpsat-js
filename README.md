# cpsat-js

WebAssembly port of Google OR-Tools' CP-SAT constraint programming solver. Runs in browser and Node.js with zero native dependencies.

## Install

```bash
npm install cpsat-js
```

## Build variants (threaded / portable)

The package ships **two compiled binaries** and picks one automatically:

| environment | variant | threads | needs `SharedArrayBuffer` |
|---|---|---|---|
| Node.js | threaded | yes (8 by default) | yes — always available in Node |
| browsers, Deno, Bun, edge | portable | no | no |

CP-SAT gets most of its speed from a **parallel subsolver portfolio**, so the threaded
build is dramatically faster — on a 512-variable model, 431ms vs 4,065ms for the same
proven-optimal answer.

`import { CpSolver } from 'cpsat-js'` resolves correctly on its own via conditional
exports, so most users need do nothing. Override explicitly if you need to:

```ts
import { CpSolver } from 'cpsat-js/threaded';  // requires SharedArrayBuffer
import { CpSolver } from 'cpsat-js/portable';  // works anywhere
```

### Using the threaded build in a browser

The threaded binary allocates shared WASM memory, which requires `SharedArrayBuffer`,
which browsers only expose to [cross-origin isolated](https://web.dev/articles/cross-origin-isolation-guide)
pages. Serve your page with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Then import `cpsat-js/threaded` explicitly — the default `browser` condition
deliberately resolves to the portable build, since most pages are not isolated. Note
that these headers block embedding cross-origin resources that don't send CORP/CORS
headers, so they are a deployment-wide decision.

## Using with Vite

Add `cpsat-js` to `optimizeDeps.exclude` in your `vite.config.ts`:

```ts
export default defineConfig({
  optimizeDeps: {
    exclude: ['cpsat-js'],
  },
});
```

Without this, Vite's dep pre-bundler (esbuild) copies the package into `node_modules/.vite/deps/` and breaks the relative `new URL('../build/portable/cpsat.wasm', import.meta.url)` lookup — the dev server then returns the SPA HTML fallback for the WASM request, and Emscripten fails with `CompileError: expected magic word 00 61 73 6d, found 3c 21 64 6f` (`<!do`... from the HTML). Excluding the package routes it through Vite's main asset pipeline, which rewrites the URL correctly. Production builds (`vite build`) don't use the pre-bundler and work without this flag, but it's harmless to set in both.

## Quick Start

```typescript
import { CpModel, CpSolver, CpSolverStatus } from 'cpsat-js';

const solver = await CpSolver.create();

// Solve: maximize x + y subject to x + y <= 10
const model = new CpModel();
const x = model.newIntVar(0, 10, 'x');
const y = model.newIntVar(0, 10, 'y');

model.add(x.plus(y).le(10));
model.maximize(x.plus(y));

const result = solver.solve(model);

if (result.status === CpSolverStatus.OPTIMAL) {
  console.log(`x = ${result.value(x)}, y = ${result.value(y)}`);
  console.log(`objective = ${result.objectiveValue}`);
}
```

## Supported Constraints

- Linear constraints (`add(expr.le(val))`, `add(expr.ge(val))`, `add(expr.equals(val))`)
- `addAllDifferent([...vars])` — forces all variables to take distinct values
- `addBoolOr([...literals])` / `addBoolAnd([...literals])` — boolean logic
- `addNoOverlap([...intervals])` — scheduling / disjunctive constraints
- `addCircuit([[tail, head, literal], ...])` — routing / TSP
- `minimize(expr)` / `maximize(expr)` — optimization objectives
- `.onlyEnforceIf(literal)` — conditional enforcement (half-reification)

## Examples

### Knapsack

```typescript
const model = new CpModel();
const items = [[60, 10], [100, 20], [120, 30]]; // [value, weight]
const capacity = 50;

const take = items.map((_, i) => model.newBoolVar(`take_${i}`));
const weight = take.reduce((acc, t, i) => acc.plus(t.times(items[i][1])), take[0].times(0));
const value = take.reduce((acc, t, i) => acc.plus(t.times(items[i][0])), take[0].times(0));

model.add(weight.le(capacity));
model.maximize(value);

const result = solver.solve(model);
```

### N-Queens

```typescript
const n = 8;
const model = new CpModel();
const queens = Array.from({ length: n }, (_, i) => model.newIntVar(0, n - 1, `q${i}`));

model.addAllDifferent(queens);
model.addAllDifferent(queens.map((q, i) => q.plus(i)));   // diagonals
model.addAllDifferent(queens.map((q, i) => q.minus(i)));  // anti-diagonals

const result = solver.solve(model);
const cols = queens.map(q => result.value(q));
```

### Scheduling

```typescript
const model = new CpModel();
const durations = [3, 5, 2];
const horizon = 10;

const starts = durations.map((_, i) => model.newIntVar(0, horizon, `s${i}`));
const ends = durations.map((_, i) => model.newIntVar(0, horizon, `e${i}`));
const intervals = durations.map((d, i) =>
  model.newIntervalVar(starts[i], d, ends[i], `task${i}`),
);

model.addNoOverlap(intervals);

const makespan = model.newIntVar(0, horizon, 'makespan');
ends.forEach(e => model.add(makespan.ge(e)));
model.minimize(makespan);

const result = solver.solve(model);
```

## API Reference

### `CpModel`

Builder for constraint programming models.

- `newIntVar(lb, ub, name): IntVar`
- `newBoolVar(name): BoolVar`
- `newConstant(value): IntVar`
- `newIntervalVar(start, size, end, name): IntervalVar`
- `add(boundedExpr): Constraint` — adds a linear constraint like `x.plus(y).le(10)`
- `addAllDifferent(vars): Constraint`
- `addBoolOr(literals): Constraint`
- `addBoolAnd(literals): Constraint`
- `addNoOverlap(intervals): Constraint`
- `addCircuit(arcs): Constraint`
- `minimize(expr)` / `maximize(expr)`

### `IntVar` / `BoolVar`

Expression building methods:
- `plus(other)`, `minus(other)`, `times(scalar)`, `negate()`
- `equals(other)`, `le(other)`, `ge(other)`, `lt(other)`, `gt(other)`, `notEquals(other)`
- `not()` — returns the negative literal (for boolean vars)

### `CpSolver`

- `static create(options?): Promise<CpSolver>` — async factory that loads WASM. The
  6MB binary is fetched lazily here, not at import.
- `solve(model, params?): CpSolverResult`

#### `SolverParams`

- `maxTimeInSeconds?: number` — wall-clock limit. On timeout you get `FEASIBLE` (best
  solution found) or `UNKNOWN` (none found yet), never a throw.
- `numWorkers?: number` — parallel subsolvers, default `8`.

> **Use `1` or `>= 6`, never in between.** `num_workers` selects *which* subsolver
> portfolio CP-SAT runs, not just how much parallelism it gets. Below 6 it runs a
> degraded subset: on a representative model, 2 workers took 13.9s and 4 workers 38.4s
> where **1 worker took 7.7s and 8 workers took 0.4s**. The gain is portfolio
> composition rather than parallelism, so 8 workers is worth setting even on a single
> core. The portable build has no threads and clamps this to 1 automatically.

### `CpSolverResult`

- `status: CpSolverStatus` (`UNKNOWN`, `MODEL_INVALID`, `FEASIBLE`, `INFEASIBLE`, `OPTIMAL`)
- `objectiveValue: number`
- `bestObjectiveBound: number`
- `wallTime: number` (seconds)
- `value(variable): number` — solution value
- `response: CpSolverResponse` — raw protobuf response

## Architecture

- **TypeScript wrapper** builds a `CpModelProto` via a fluent API
- **Protobuf serialization** (`@bufbuild/protobuf`) is the JS↔WASM boundary
- **Single WASM export** — `solve(proto_bytes) → response_bytes`
- **CP-SAT core** (OR-Tools) runs inside WebAssembly

## Building from Source

Requires CMake 3.18+, Ninja, and Emscripten.

```bash
npm install
npm run build:proto    # Generate TS types from .proto
npm run build:wasm     # Compile both WASM variants (slow: ~40min first time)
npm run build:ts       # Compile TypeScript
npm test               # Run unit + integration tests
```

`build:wasm` builds both variants, because `-pthread` changes codegen across the whole
OR-Tools/abseil/protobuf tree and they therefore need separate build trees. To iterate
on just one:

```bash
./build.sh threaded    # or: portable, both (default)
```

## License

Apache 2.0 (same as OR-Tools).

## Credits

- [Google OR-Tools](https://github.com/google/or-tools) — the CP-SAT solver
- [highs-js](https://github.com/lovasoa/highs-js) — inspiration for the WASM packaging approach
