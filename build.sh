#!/bin/bash
set -euo pipefail

# Ensure Homebrew Python (>= 3.10) takes precedence over system Python 3.9
# Emscripten's scripts use `list[str] | None` syntax which requires Python 3.10+
if [ -d "/opt/homebrew/bin" ]; then
  export PATH="/opt/homebrew/bin:$PATH"
fi

# Build one variant. $1 = variant name (threaded|portable), $2 = CPSAT_THREADS value.
#
# The two variants need separate build trees, not two targets in one: -pthread changes
# codegen for the whole OR-Tools/abseil/protobuf dependency tree, so the deps must be
# compiled twice. That is why a full build is roughly 2x single-variant time.
build_variant() {
  local VARIANT="$1"
  local THREADS="$2"
  local BUILD_DIR="build-$VARIANT"
  echo ""
  echo "############ Building '$VARIANT' variant (CPSAT_THREADS=$THREADS) ############"
  mkdir -p "$BUILD_DIR"

echo "=== Stage 1: Configure with Emscripten ==="
emcmake cmake -B "$BUILD_DIR" -S . \
  -DCMAKE_BUILD_TYPE=Release \
  -DCPSAT_THREADS="$THREADS" \
  -DOR_TOOLS_PROTOC_EXECUTABLE=/usr/local/bin/protoc \
  -G Ninja

echo "=== Stage 2: Patch build.ninja for cross-compilation ==="
# Fix 1: Remove self-referencing phony rule that conflicts with CUSTOM_COMMAND
# OR-Tools generates a duplicate rule for host_tools
sed -i.bak 's|build _deps/or-tools-build/host_tools: phony _deps/or-tools-build/CMakeFiles/host_tools _deps/or-tools-build/host_tools|# patched: removed conflicting phony\nbuild _deps/or-tools-build/host_tools/bin/protoc: phony _deps/or-tools-build/host_tools|' "$BUILD_DIR/build.ninja"

rm -f "$BUILD_DIR/build.ninja.bak"

echo "=== Stage 3: Build ==="
NPROC=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
emmake ninja -C "$BUILD_DIR" cpsat_wasm -j"$NPROC"

  echo "=== Stage 4: Stage artifacts into build/$VARIANT ==="
  mkdir -p "build/$VARIANT"
  cp "$BUILD_DIR/cpsat.mjs" "$BUILD_DIR/cpsat.wasm" "build/$VARIANT/"
  ls -lh "build/$VARIANT"/cpsat.{mjs,wasm}
}

# Threaded is the default consumers get in Node; portable is the browser fallback and
# works anywhere without cross-origin isolation.
VARIANTS="${1:-both}"
case "$VARIANTS" in
  threaded) build_variant threaded ON ;;
  portable) build_variant portable OFF ;;
  both)     build_variant threaded ON; build_variant portable OFF ;;
  *) echo "usage: ./build.sh [threaded|portable|both]" >&2; exit 1 ;;
esac

echo ""
echo "=== Done ==="
