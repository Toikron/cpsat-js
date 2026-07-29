// What a hint is, and — more importantly — what it is not.
//
// A hint is advisory: somewhere to start the search, with no power to constrain
// anything. That is the property worth testing, because the failure mode of a hint
// implementation is to quietly fix variables instead of suggesting them, and a
// model that agrees with its hint cannot tell the difference. So every test here
// hints something wrong on purpose and asserts the optimum is reached anyway.
import { describe, it, expect, beforeAll } from 'vitest';
import { CpModel, CpSolver, CpSolverStatus } from '../../src/index.threaded.js';

describe('Solution hints', () => {
  let solver: CpSolver;

  beforeAll(async () => {
    solver = await CpSolver.create();
  });

  /** The knapsack whose optimum is 220: items 1 and 2, filling the bag exactly. */
  const knapsack = () => {
    const model = new CpModel('hinted-knapsack');
    const items = [
      [60, 10],
      [100, 20],
      [120, 30],
    ];
    const take = items.map((_, i) => model.newBoolVar(`take_${i}`));
    const fold = (which: number) =>
      take.reduce((acc, t, i) => acc.plus(t.times(items[i][which])), take[0].times(0));

    model.add(fold(1).le(50));
    model.maximize(fold(0));
    return { model, take };
  };

  it('reaches the optimum from a hint that is the optimum', () => {
    const { model, take } = knapsack();
    take.forEach((t, i) => model.addHint(t, i === 0 ? 0 : 1));

    const result = solver.solve(model);
    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    expect(result.objectiveValue).toBe(220);
  });

  it('reaches the optimum from a hint that is a worse solution', () => {
    const { model, take } = knapsack();
    // Feasible — item 0 alone weighs 10 — but worth 60 against the best 220.
    take.forEach((t, i) => model.addHint(t, i === 0 ? 1 : 0));

    const result = solver.solve(model);
    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    expect(result.objectiveValue).toBe(220);
    expect(result.value(take[0])).toBe(0);
  });

  it('reaches the optimum from a hint that is not even feasible', () => {
    const { model, take } = knapsack();
    // Every item taken weighs 60 against a capacity of 50.
    take.forEach((t) => model.addHint(t, 1));

    const result = solver.solve(model);
    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    expect(result.objectiveValue).toBe(220);
  });

  // A partial hint is the intended way to use this: name the decisions and let
  // propagation settle the rest.
  it('accepts a hint that names only some of the variables', () => {
    const { model, take } = knapsack();
    model.addHint(take[2], 1);

    const result = solver.solve(model);
    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    expect(result.objectiveValue).toBe(220);
  });

  it('cannot rescue an infeasible model', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    model.add(x.ge(5));
    model.add(x.le(4));
    model.addHint(x, 7);

    expect(solver.solve(model).status).toBe(CpSolverStatus.INFEASIBLE);
  });
});
