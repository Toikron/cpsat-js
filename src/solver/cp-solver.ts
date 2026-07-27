import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import {
  CpModelProtoSchema,
  CpSolverResponseSchema,
  CpSolverStatus,
  type CpSolverResponse,
} from '../generated/cp_model_pb.js';
import {
  SatParametersSchema,
} from '../generated/sat_parameters_pb.js';
import type { CpModel } from '../model/cp-model.js';
import type { IntVar } from '../model/int-var.js';

export { CpSolverStatus };

export interface CpSolverOptions {
  /** Custom path resolver for the WASM binary */
  locateFile?: (path: string) => string;
}

interface CpSatModule {
  _solve(modelPtr: number, modelLen: number, paramsPtr: number, paramsLen: number): number;
  _get_result_ptr(): number;
  _free_result(): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
}

export type WasmFactory = (options?: Record<string, unknown>) => Promise<CpSatModule>;

/**
 * Loads the Emscripten glue for one build variant.
 *
 * Supplied by the package entry point rather than resolved here, so that each entry
 * references exactly one literal WASM path. A bundler following the "browser"
 * condition then only ever sees the portable binary, and never emits the threaded
 * one as an asset.
 */
export type GlueLoader = (locateFile?: (path: string) => string) => Promise<WasmFactory>;

let glueLoader: GlueLoader | undefined;
let glueIsThreaded = false;

/** @internal — called by the package entry point (index.threaded / index.portable). */
export function setGlueLoader(loader: GlueLoader, threaded: boolean): void {
  glueLoader = loader;
  glueIsThreaded = threaded;
}

export interface SolverParams {
  maxTimeInSeconds?: number;
  /**
   * Number of parallel subsolvers. Defaults to 8.
   *
   * This is not a simple speed/resource dial: `num_workers` selects which subsolver
   * portfolio CP-SAT runs. Below 6 it runs a degraded subset — 2 and 4 are slower
   * than 1 on real models. Use 1 or >= 6, never in between.
   */
  numWorkers?: number;
}

export interface CpSolverResult {
  status: CpSolverStatus;
  objectiveValue: number;
  bestObjectiveBound: number;
  wallTime: number;
  /** Get the value of a variable in the solution */
  value(variable: IntVar): number;
  /** Raw response proto */
  response: CpSolverResponse;
}

/**
 * Loads the WASM module and solves CP-SAT models.
 *
 * Usage:
 *   const solver = await CpSolver.create();
 *   const result = solver.solve(model);
 */
export class CpSolver {
  private module: CpSatModule;

  private constructor(module: CpSatModule) {
    this.module = module;
  }

  static async create(options?: CpSolverOptions): Promise<CpSolver> {
    if (!glueLoader) {
      throw new Error(
        "No WASM build was registered. Import the package entry point ('cpsat-js', " +
          "'cpsat-js/threaded' or 'cpsat-js/portable') rather than a deep internal path.",
      );
    }
    // The glue — and therefore the 6MB WASM — is only loaded here, on first create().
    const createModule = await glueLoader(options?.locateFile);
    const module = await createModule();
    return new CpSolver(module);
  }

  solve(model: CpModel, params?: SolverParams): CpSolverResult {
    const modelProto = model.toProto();
    const modelBytes = toBinary(CpModelProtoSchema, modelProto);

    const satParams = create(SatParametersSchema, {});
    // CP-SAT's speed comes from its parallel subsolver portfolio, which only engages
    // at >= 6 workers; 2 and 4 are measurably SLOWER than 1. The threaded WASM is
    // built with a pre-spawned pthread pool, so 8 is both safe and the right default.
    satParams.numWorkers = 8;
    if (params?.maxTimeInSeconds !== undefined) {
      satParams.maxTimeInSeconds = params.maxTimeInSeconds;
    }
    if (params?.numWorkers !== undefined) {
      satParams.numWorkers = params.numWorkers;
    }
    // The portable build has no threads. Clamp to 1 rather than to some lower count:
    // anything in 2..5 selects a degraded portfolio and is slower than a single worker.
    if (!glueIsThreaded) {
      satParams.numWorkers = 1;
    }
    const paramsBytes = toBinary(SatParametersSchema, satParams);

    // Allocate WASM heap memory for model
    const modelPtr = this.module._malloc(modelBytes.length);
    this.module.HEAPU8.set(modelBytes, modelPtr);

    // Allocate WASM heap memory for params
    const paramsPtr = this.module._malloc(paramsBytes.length);
    this.module.HEAPU8.set(paramsBytes, paramsPtr);

    let resultLen: number;
    try {
      resultLen = this.module._solve(modelPtr, modelBytes.length, paramsPtr, paramsBytes.length);
    } finally {
      this.module._free(modelPtr);
      this.module._free(paramsPtr);
    }

    // Read result from WASM memory
    const resultPtr = this.module._get_result_ptr();
    const resultBytes = new Uint8Array(
      this.module.HEAPU8.buffer,
      resultPtr,
      resultLen,
    );
    // Copy before freeing
    const resultCopy = new Uint8Array(resultBytes);
    this.module._free_result();

    const response = fromBinary(CpSolverResponseSchema, resultCopy);

    return {
      status: response.status,
      objectiveValue: response.objectiveValue,
      bestObjectiveBound: response.bestObjectiveBound,
      wallTime: response.wallTime,
      value(variable: IntVar): number {
        return Number(response.solution[variable.index]);
      },
      response,
    };
  }
}

/**
 * Shared plumbing for the per-variant glue loaders. Each caller passes its own
 * statically-analysable import, so only that variant's WASM is ever emitted.
 */
export function makeGlueLoader(
  importGlue: () => Promise<{ default?: unknown }>,
  wasmUrl: () => string,
): GlueLoader {
  return async (locateFile) => {
    const glue = await importGlue();
    const factory = glue.default as WasmFactory | undefined;
    if (typeof factory !== 'function') {
      throw new Error('cpsat glue did not export a factory function');
    }
    const url = wasmUrl();
    const resolvedLocate =
      locateFile ?? ((path: string) => (path.endsWith('.wasm') ? url : path));
    return (options) => factory({ ...options, locateFile: resolvedLocate });
  };
}
