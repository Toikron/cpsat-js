FROM emscripten/emsdk:3.1.73

ARG CPSAT_VARIANT=both

RUN apt-get update && apt-get install -y --no-install-recommends \
    ninja-build python3-pip \
    && python3 -m pip install --no-cache-dir 'cmake>=3.24,<4' \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Copy build files first (better layer caching)
COPY CMakeLists.txt build.sh ./
COPY src/cpp/ src/cpp/

RUN ./build.sh "$CPSAT_VARIANT"

# Copy output for extraction
RUN mkdir -p /output/build && cp -R build/threaded build/portable /output/build/
