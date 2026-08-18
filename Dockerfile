FROM emscripten/emsdk:3.1.73

ARG CPSAT_VARIANT=both

RUN apt-get update && apt-get install -y --no-install-recommends \
    ninja-build protobuf-compiler python3-pip \
    && python3 -m pip install --no-cache-dir 'cmake>=3.24,<4' \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Copy build files first (better layer caching)
COPY CMakeLists.txt build.sh ./
COPY src/cpp/ src/cpp/

RUN ./build.sh "$CPSAT_VARIANT"

# Copy whichever variant this image built. Matrix CI builds the two variants in
# parallel, while local `CPSAT_VARIANT=both` still stages both directories.
RUN mkdir -p /output/build && cp -R build/* /output/build/
