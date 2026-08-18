FROM emscripten/emsdk:3.1.73

ARG CPSAT_VARIANT=both
ARG PROTOC_VERSION=33.1
ARG PROTOC_SHA256=f3340e28a83d1c637d8bafdeed92b9f7db6a384c26bca880a6e5217b40a4328b

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl ninja-build python3-pip unzip \
    && python3 -m pip install --no-cache-dir 'cmake>=3.24,<4' \
    && curl -fsSL -o /tmp/protoc.zip \
      "https://github.com/protocolbuffers/protobuf/releases/download/v${PROTOC_VERSION}/protoc-${PROTOC_VERSION}-linux-x86_64.zip" \
    && echo "${PROTOC_SHA256}  /tmp/protoc.zip" | sha256sum -c - \
    && unzip -q /tmp/protoc.zip -d /usr/local \
    && rm /tmp/protoc.zip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Copy build files first (better layer caching)
COPY CMakeLists.txt build.sh ./
COPY src/cpp/ src/cpp/

RUN ./build.sh "$CPSAT_VARIANT"

# Copy whichever variant this image built. Matrix CI builds the two variants in
# parallel, while local `CPSAT_VARIANT=both` still stages both directories.
RUN mkdir -p /output/build && cp -R build/* /output/build/
