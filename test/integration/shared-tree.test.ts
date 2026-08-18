import { beforeAll, describe, expect, it } from 'vitest';
import { CpModel, CpSolver, CpSolverStatus } from '../../src/index.threaded.js';

describe('native shared-tree parameters', () => {
  let solver: CpSolver;

  beforeAll(async () => {
    solver = await CpSolver.create();
  });

  it('solves one disjoint native tree and stops at its first complete solution', () => {
    const model = new CpModel('shared-tree-smoke');
    const bits = Array.from({ length: 12 }, (_, index) => model.newBoolVar(`bit_${index}`));
    model.add(
      bits
        .slice(1)
        .reduce((sum, bit) => sum.plus(bit.toLinearExpr()), bits[0].toLinearExpr())
        .equals(6),
    );

    const result = solver.solve(model, {
      randomSeed: 2,
      numWorkers: 8,
      sharedTreeNumWorkers: 8,
      sharedTreeOpenLeavesPerWorker: 4,
      sharedTreeMaxNodesPerWorker: 20_000,
      sharedTreeSplitStrategy: 3,
      sharedTreeWorkerMinRestartsPerSubtree: 1,
      sharedTreeSplitMinDtime: 0.05,
      stopAfterFirstSolution: true,
    });

    expect([CpSolverStatus.FEASIBLE, CpSolverStatus.OPTIMAL]).toContain(result.status);
    expect(bits.reduce((sum, bit) => sum + result.value(bit), 0)).toBe(6);
  });
});
