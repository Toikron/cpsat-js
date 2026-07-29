// The solution callback, and above all how many times it fires.
//
// A callback that fires once when it should fire fifteen times passes every
// assertion you would naturally write about the solutions it did deliver — the last
// one is still the answer, the objective still matches. So the count is asserted
// here, and the model is chosen to make a long chain of incumbents unavoidable.
//
// It is a weighted max-cut on 20 nodes, built from a seeded generator so it is the
// same model on every run. Measured: 15 improving solutions at one worker and 12 at
// eight, both proving 263 optimal, in well under a second either way. A knapsack —
// the obvious first choice — is useless here: CP-SAT cracks one in presolve and
// reports exactly one solution no matter how many items it has.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  CpModel,
  CpSolver,
  CpSolverStatus,
  type BoolVar,
  type CpSolverSolution,
} from '../../src/index.threaded.js';

describe('Solution callbacks', () => {
  let solver: CpSolver;

  beforeAll(async () => {
    solver = await CpSolver.create();
  });

  /** A seeded generator, so the model below is a fixed model and not a random one. */
  const rand = (seed: number) => {
    let s = seed;
    return (n: number) => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s % n;
    };
  };

  /**
   * Weighted max-cut: split the nodes in two, and score every edge whose ends land on
   * opposite sides. Hard enough that CP-SAT has to climb to the answer rather than
   * deduce it, which is the only property this file needs.
   */
  const maxCut = () => {
    const nodes = 20;
    const next = rand(11);
    const model = new CpModel('max-cut');
    const side = Array.from({ length: nodes }, (_, i) => model.newBoolVar(`side_${i}`));
    const edges: { ends: [BoolVar, BoolVar]; weight: number; cut: BoolVar }[] = [];

    for (let i = 0; i < nodes; i++) {
      for (let d = 0; d < 3; d++) {
        const j = (i + 1 + next(nodes - 1)) % nodes;
        if (i === j) continue;
        const cut = model.newBoolVar(`cut_${i}_${d}`);
        // cut => the ends differ, both ways round.
        model.add(cut.le(side[i].plus(side[j])));
        model.add(cut.plus(side[i]).plus(side[j].toLinearExpr()).le(2));
        edges.push({ ends: [side[i], side[j]], weight: next(9) + 1, cut });
      }
    }

    model.maximize(
      edges.reduce((acc, e) => acc.plus(e.cut.times(e.weight)), side[0].times(0)),
    );
    return { model, side, edges };
  };

  const OPTIMUM = 263;

  const collect = (numWorkers: number) => {
    const { model, side, edges } = maxCut();
    const seen: CpSolverSolution[] = [];
    const result = solver.solve(model, { numWorkers, onSolution: (s) => seen.push(s) });
    return { seen, result, side, edges };
  };

  it('reports a chain of improving solutions at one worker, live', () => {
    const { seen, result } = collect(1);

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((s) => s.live)).toBe(true);
    expect(result.status).toBe(CpSolverStatus.OPTIMAL);
    expect(result.objectiveValue).toBe(OPTIMUM);
    expect(seen[seen.length - 1].objectiveValue).toBe(OPTIMUM);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].objectiveValue).toBeGreaterThan(seen[i - 1].objectiveValue);
    }
  });

  it('reports the same kind of chain at eight workers, recorded', () => {
    const { seen, result } = collect(8);

    expect(seen.length).toBeGreaterThanOrEqual(3);
    // Recorded, not live: the observer ran on subsolver threads that cannot enter JS,
    // so these were replayed in order once the search was over.
    expect(seen.every((s) => s.live)).toBe(false);
    expect(result.objectiveValue).toBe(OPTIMUM);
    expect(seen[seen.length - 1].objectiveValue).toBe(OPTIMUM);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].objectiveValue).toBeGreaterThan(seen[i - 1].objectiveValue);
    }
    // The two searches are different searches and do not find the same solutions in
    // the same order, so only the shape of the sequence is asserted, never equality
    // with the one-worker run.
  });

  // Not "the objective the solver reported", which would be the solver agreeing with
  // itself: the score is recomputed here from the variable values the payload exposes.
  it('gives an incumbent values that add up to the objective it claims', () => {
    const { seen, edges } = collect(1);

    for (const solution of seen) {
      let scored = 0;
      for (const { ends, weight, cut } of edges) {
        const taken = solution.value(cut);
        expect([0, 1]).toContain(taken);
        // Summed over the cut variables, because that is what the objective sums. Not
        // over the partition: an edge whose ends differ is *permitted* to be cut, not
        // obliged to be, so an incumbent part-way up the climb can leave one uncut.
        if (taken) {
          const [a, b] = ends.map((end) => solution.value(end));
          expect(a).not.toBe(b);
        }
        scored += taken * weight;
      }
      expect(scored).toBe(solution.objectiveValue);
    }
  });

  // The response an observer receives is assembled inside the shared response manager
  // rather than by the code that fills in a final result, so neither of these carries
  // over from the non-callback path for free.
  it('stamps an incumbent with the wall time it was found at', () => {
    const { seen, result } = collect(1);

    expect(seen[0].wallTime).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].wallTime).toBeGreaterThanOrEqual(seen[i - 1].wallTime);
    }
    expect(seen[seen.length - 1].wallTime).toBeLessThanOrEqual(result.wallTime);
  });

  it('reports a bound that brackets a maximised objective from above', () => {
    const { seen, result } = collect(1);

    // maximize negates the objective internally, so the sign of the bound is worth
    // pinning down: it has to be an upper bound on a maximisation, and it has to close
    // once optimality is proved.
    for (const s of seen) {
      expect(s.bestObjectiveBound).toBeGreaterThanOrEqual(s.objectiveValue);
    }
    expect(result.bestObjectiveBound).toBe(result.objectiveValue);
  });

  it('does not fire when there is nothing to report', () => {
    const model = new CpModel();
    const x = model.newIntVar(0, 10, 'x');
    model.add(x.ge(5));
    model.add(x.le(4));

    const seen: CpSolverSolution[] = [];
    const result = solver.solve(model, { numWorkers: 1, onSolution: (s) => seen.push(s) });

    expect(result.status).toBe(CpSolverStatus.INFEASIBLE);
    expect(seen).toHaveLength(0);
  });

  it('solves the same whether or not anyone is watching', () => {
    const watched = solver.solve(maxCut().model, { numWorkers: 1, onSolution: () => {} });
    const unwatched = solver.solve(maxCut().model, { numWorkers: 1 });

    expect(watched.objectiveValue).toBe(unwatched.objectiveValue);
    expect(watched.status).toBe(unwatched.status);
  });
});
