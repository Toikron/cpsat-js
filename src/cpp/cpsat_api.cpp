// Copyright 2024 ortools-wasm contributors
// Licensed under the Apache License, Version 2.0
//
// The WASM entry point: protobuf bytes in, protobuf bytes out.
//
// This builds the CP-SAT Model itself rather than calling OR-Tools' C shim
// SolveCpModelWithParameters, because that shim takes no callback and a solution
// observer is the whole reason anything here is more than four lines long.

#include <emscripten/emscripten.h>

#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "absl/log/check.h"
#include "ortools/sat/cp_model.pb.h"
#include "ortools/sat/cp_model_solver.h"
#include "ortools/sat/model.h"
#include "ortools/sat/sat_parameters.pb.h"

namespace {

using operations_research::sat::CpModelProto;
using operations_research::sat::CpSolverResponse;
using operations_research::sat::Model;
using operations_research::sat::NewFeasibleSolutionObserver;
using operations_research::sat::NewSatParameters;
using operations_research::sat::SatParameters;
using operations_research::sat::SolveCpModel;

void* g_result = nullptr;
int g_result_len = 0;

// Incumbents found on a thread that cannot enter JS, kept until the caller reads
// them. Cleared at the start of each solve, so `solve` owns their lifetime and no
// ordering rule links this to free_result().
std::vector<std::string> g_solutions;
std::mutex g_solutions_mutex;

}  // namespace

// Hand one serialized CpSolverResponse to JS, mid-solve.
//
// HEAPU8.slice copies rather than viewing: the bytes live in a std::string that is
// gone the moment this returns, and ALLOW_MEMORY_GROWTH can swap the heap buffer
// out from under a view anyway.
EM_JS(void, cpsat_emit_solution, (const void* bytes, int len), {
  Module["__cpsatOnSolution"](HEAPU8.slice(bytes, bytes + len));
});

extern "C" {

EMSCRIPTEN_KEEPALIVE
int solve(const void* model_bytes, int model_len, const void* params_bytes,
          int params_len, int observe) {
  if (g_result) {
    free(g_result);
    g_result = nullptr;
  }
  g_solutions.clear();

  CpModelProto proto;
  CHECK(proto.ParseFromArray(model_bytes, model_len));
  SatParameters params;
  CHECK(params.ParseFromArray(params_bytes, params_len));

  Model model;
  model.Add(NewSatParameters(params));

  if (observe) {
    // Which thread the observer runs on decides whether it can enter JS at all.
    //
    // At one worker CP-SAT solves sequentially on this thread, so the observer runs
    // here and calling into JS is no different from returning to it. Above one
    // worker the observer runs on a subsolver pthread — a separate Web Worker under
    // Emscripten — while this thread sits blocked inside SolveCpModel. Entering JS
    // from there would need proxying to a thread that cannot answer, so it records
    // instead and the caller reads the trace once the solve is over.
    //
    // num_workers is what decides it: SolveCpModelParallel is chosen on
    // num_workers > 1 together with interleave_search, subsolvers and use_ls_only,
    // none of which this port sets.
    const bool live = params.num_workers() == 1;
    const std::thread::id solve_thread = std::this_thread::get_id();

    model.Add(NewFeasibleSolutionObserver(
        [live, solve_thread](const CpSolverResponse& response) {
          std::string bytes;
          CHECK(response.SerializeToString(&bytes));
          if (live) {
            // The prediction above, checked rather than trusted. If CP-SAT ever
            // observes from another thread at one worker, fail here and loudly —
            // the alternative is a deadlock with no explanation.
            CHECK(std::this_thread::get_id() == solve_thread);
            cpsat_emit_solution(bytes.data(), static_cast<int>(bytes.size()));
          } else {
            const std::lock_guard<std::mutex> lock(g_solutions_mutex);
            g_solutions.push_back(std::move(bytes));
          }
        }));
  }

  const CpSolverResponse res = SolveCpModel(proto, &model);

  std::string res_str;
  CHECK(res.SerializeToString(&res_str));
  g_result_len = static_cast<int>(res_str.size());
  g_result = malloc(g_result_len);
  CHECK(g_result != nullptr);
  memcpy(g_result, res_str.data(), g_result_len);
  return g_result_len;
}

EMSCRIPTEN_KEEPALIVE
void* get_result_ptr() { return g_result; }

EMSCRIPTEN_KEEPALIVE
void free_result() {
  if (g_result) {
    free(g_result);
    g_result = nullptr;
    g_result_len = 0;
  }
}

// ── The recorded trace, read after solve() returns ──
//
// A live solve records nothing, so a caller can always drain unconditionally: the
// count says which of the two happened, and JS never has to re-derive the rule.

EMSCRIPTEN_KEEPALIVE
int solution_count() { return static_cast<int>(g_solutions.size()); }

EMSCRIPTEN_KEEPALIVE
const void* solution_ptr(int index) { return g_solutions[index].data(); }

EMSCRIPTEN_KEEPALIVE
int solution_len(int index) {
  return static_cast<int>(g_solutions[index].size());
}

}  // extern "C"
