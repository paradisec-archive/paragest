ARG FUNCTION_DIR="/function"

FROM node:lts-bookworm as build-image

ARG FUNCTION_DIR

RUN apt-get update && \
  apt-get install -y \
  g++ \
  make \
  cmake \
  unzip \
  libcurl4-openssl-dev && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

RUN mkdir -p ${FUNCTION_DIR}/src ${FUNCTION_DIR}/lib
COPY src/audio/fix-alignment.ts ${FUNCTION_DIR}/src/
COPY src/lib/*.ts ${FUNCTION_DIR}/lib/
COPY docker/fix-alignment/package.json ${FUNCTION_DIR}
COPY docker/fix-alignment/yarn.lock ${FUNCTION_DIR}

WORKDIR ${FUNCTION_DIR}

RUN yarn --immutable

RUN ./node_modules/.bin/esbuild \
  --bundle src/fix-alignment.ts \
  --target=esnext \
  --platform=node \
  --format=esm \
  --outfile=index.js \
  --minify \
  --sourcemap=external \
  --sources-content=true \
  --loader:.node=copy \
  --banner:js="import { createRequire } from 'module';const require = createRequire(import.meta.url);" \
  --main-fields=module,main

RUN npm install aws-lambda-ric

# Grab a fresh slim copy of the image to reduce the final size
FROM node:lts-slim

# Required for Node runtimes which use npm@8.6.0+ because
# by default npm writes logs under /home/.npm and Lambda fs is read-only
ENV NPM_CONFIG_CACHE=/tmp/.npm

# Include global arg in this stage of the build
ARG FUNCTION_DIR

# Set working directory to function root directory
WORKDIR ${FUNCTION_DIR}

# INstall the needed tools
RUN apt update && \
  apt-get install -y --no-install-recommends wget python3 python3-pip xz-utils ca-certificates && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

ARG ffmpegURL=https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
RUN wget -O ffmpeg.tar.xz ${ffmpegURL}
RUN tar xf ffmpeg.tar.xz
RUN mv ffmpeg*/ffmpeg /usr/local/bin

RUN pip3 install --break-system-packages audio-offset-finder

# Copy in the built dependencies
COPY --from=build-image ${FUNCTION_DIR} ${FUNCTION_DIR}

ENV NUMBA_CACHE_DIR /tmp

ENTRYPOINT ["/usr/local/bin/npx", "aws-lambda-ric"]
CMD ["index.handler"]
