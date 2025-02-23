FROM node:lts-alpine AS build-image

ARG SOURCE_FILE

WORKDIR /function

COPY .yarnrc.yml /function
COPY package.json /function
COPY yarn.lock /function

RUN corepack enable && \
  yarn --immutable

COPY src/ /function/src/
RUN ls -lR /function/src

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

FROM ubuntu:24.10

# SHELL ["/bin/bash", "-exo", "pipefail", "-c"]

ARG FUNCTION_DIR

ARG MEDIA_INFO_URL="https://mediaarea.net/download/binary/mediainfo/24.12/mediainfo_24.12-1_amd64.Ubuntu_24.10.deb"
ARG LIB_MEDIA_INFO_URL="https://mediaarea.net/download/binary/libmediainfo0/24.12/libmediainfo0v5_24.12-1_amd64.Ubuntu_24.10.deb"
ARG LIB_ZEN_URL="https://mediaarea.net/download/binary/libzen0/0.4.41/libzen0v5_0.4.41-1_amd64.Ubuntu_24.10.deb"
ARG BWF_METAEDIT_URL="https://mediaarea.net/download/binary/bwfmetaedit/24.10/bwfmetaedit_24.10-1_amd64.Ubuntu_24.04.deb"

RUN apt-get update && \
  apt-get install -y ffmpeg imagemagick wget && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /tmp
RUN wget -qO mediainfo.deb "$MEDIA_INFO_URL" && \
  wget -qO libmediainfo.deb "$LIB_MEDIA_INFO_URL" && \
  wget -qO libzen.deb "$LIB_ZEN_URL" && \
  wget -qO bwfmetaedit.deb "$BWF_METAEDIT_URL" && \
  apt-get update && \
  apt-get install -y -f ./mediainfo.deb ./libmediainfo.deb ./libzen.deb ./bwfmetaedit.deb && \
  rm -rf /var/lib/apt/lists/*

# # Set working directory to function root directory
WORKDIR /function

# Copy in the built dependencies
COPY --from=build-image /function/index.mjs /function
COPY --from=build-image /function/index.mjs.map /function

CMD ["node", "--enable-source-maps", "index.mjs"]
