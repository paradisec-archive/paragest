ARG NODE_IMAGE=node:lts-trixie-slim
ARG UBUNTU_IMAGE=ubuntu:latest

FROM ${NODE_IMAGE} AS build-image

ARG SOURCE_FILE

WORKDIR /function

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json /function/
COPY patches/ /function/patches/

# Node 25+ no longer bundles corepack
# hadolint ignore=DL3016
RUN npm install --global corepack@latest && \
  corepack enable && \
  pnpm --frozen-lockfile install

COPY src/ /function/src/

RUN ./node_modules/.bin/esbuild \
  --bundle ${SOURCE_FILE} \
  --target=esnext \
  --platform=node \
  --format=esm \
  --outfile=index.mjs \
  --minify \
  --sourcemap \
  --sources-content=true \
  --main-fields=module,main \
  --banner:js="import { createRequire } from 'module';const require = createRequire(import.meta.url);" \
  --loader:.node=copy
# Dirty hack from https://github.com/evanw/esbuild/pull/2067

FROM ${NODE_IMAGE} AS node

FROM ${UBUNTU_IMAGE}

SHELL ["/bin/bash", "-exo", "pipefail", "-c"]

ARG FUNCTION_DIR

ARG MEDIAAREA_REPO_URL="https://mediaarea.net/repo/deb/repo-mediaarea_1.0-27_all.deb"

# hadolint ignore=DL3015
RUN apt-get update && \
  apt-get install -y ffmpeg imagemagick wget ca-certificates && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /tmp
# hadolint ignore=DL3015
RUN wget -qO repo-mediaarea.deb "$MEDIAAREA_REPO_URL" && \
  dpkg -i repo-mediaarea.deb && \
  rm repo-mediaarea.deb && \
  apt-get update && \
  apt-get install -y mediainfo bwfmetaedit && \
  rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node

# # Set working directory to function root directory
WORKDIR /function

# Copy in the built dependencies
COPY --from=build-image /function/index.mjs /function
COPY --from=build-image /function/index.mjs.map /function

CMD ["node", "--enable-source-maps", "index.mjs"]
