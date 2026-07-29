import { describe, expect, it } from 'vitest';

/**
 * Both published entry points must solve correctly and agree.
 *
 * The threaded build runs CP-SAT's parallel portfolio (num_workers 8 by default) and
 * needs SharedArrayBuffer; the portable build is single-threaded and needs nothing.
 * They are separately compiled binaries, so nothing but a test guarantees they stay
 * behaviourally identical.
 */
describe('build variants', () => {
  // Small knapsack with a unique optimum, so both variants must return the same value.
  const items = [
    [60, 10],
    [100, 20],
    [120, 30],
  ] as const;
  const capacity = 50;

  async function solveWith(entry: 'threaded' | 'portable', numWorkers?: number) {
    const mod =
      entry === 'threaded'
        ? await import('../../src/index.threaded.js')
        : await import('../../src/index.portable.js');
    const { CpModel, CpSolver, CpSolverStatus } = mod;

    const model = new CpModel();
    const take = items.map((_, i) => model.newBoolVar(`take_${i}`));
    const weight = take.reduce(
      (acc, t, i) => acc.plus(t.times(items[i][1])),
      take[0].times(0),
    );
    const value = take.reduce(
      (acc, t, i) => acc.plus(t.times(items[i][0])),
      take[0].times(0),
    );
    model.add(weight.le(capacity));
    model.maximize(value);

    const solver = await CpSolver.create();
    const result = solver.solve(model, { maxTimeInSeconds: 10, numWorkers });
    return { status: result.status, objective: result.objectiveValue, CpSolverStatus };
  }

  it('threaded entry solves to optimality', async () => {
    const { status, objective, CpSolverStatus } = await solveWith('threaded');
    expect(status).toBe(CpSolverStatus.OPTIMAL);
    expect(objective).toBe(220);
  });

  it('portable entry solves to optimality', async () => {
    const { status, objective, CpSolverStatus } = await solveWith('portable');
    expect(status).toBe(CpSolverStatus.OPTIMAL);
    expect(objective).toBe(220);
  });

  it('both variants agree', async () => {
    const [a, b] = await Promise.all([solveWith('threaded'), solveWith('portable')]);
    expect(a.objective).toBe(b.objective);
  });

  // A caller may pass numWorkers > 1 without knowing which build they resolved to.
  // The portable build has no threads, so it must clamp rather than abort — and it
  // must clamp to 1, since 2..5 workers select a degraded, slower portfolio.
  it('portable entry tolerates numWorkers > 1 by clamping', async () => {
    const { status, objective, CpSolverStatus } = await solveWith('portable', 8);
    expect(status).toBe(CpSolverStatus.OPTIMAL);
    expect(objective).toBe(220);
  });

  // The clamp decides how solutions are delivered, not just how fast they arrive: one
  // worker means the observer runs on the calling thread, so the portable build always
  // reports live — even when the caller asked for eight and would have been replayed
  // to on the threaded build. This is the browser's case, which has no other coverage.
  it('portable entry reports solutions live even when eight workers were asked for', async () => {
    const { CpModel, CpSolver } = await import('../../src/index.portable.js');
    const model = new CpModel();
    const take = items.map((_, i) => model.newBoolVar(`take_${i}`));
    const fold = (which: 0 | 1) =>
      take.reduce((acc, t, i) => acc.plus(t.times(items[i][which])), take[0].times(0));
    model.add(fold(1).le(capacity));
    model.maximize(fold(0));

    const seen: boolean[] = [];
    const solver = await CpSolver.create();
    solver.solve(model, { numWorkers: 8, onSolution: (s) => seen.push(s.live) });

    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.every((live) => live)).toBe(true);
  });
});
