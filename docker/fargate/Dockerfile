FROM node:lts-alpine AS build-image

ARG SOURCE_FILE

WORKDIR /function

RUN mkdir -p /function/video /function/lib

COPY .yarnrc.yml /function
COPY package.json /function
COPY yarn.lock /function


RUN corepack enable && \
  yarn --immutable

COPY src/${SOURCE_FILE} /function/video/
COPY src/lib/*.ts /function/lib/

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

FROM node:lts-alpine

ARG FUNCTION_DIR

ARG ffmpegURL=https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz

RUN apk add --no-cache --virtual .build-deps-yarn wget \
  && mkdir /tmp/ffmpeg \
  && cd /tmp/ffmpeg \
  && wget -qO ffmpeg.tar.xz ${ffmpegURL} \
  && tar -xf ffmpeg.tar.xz \
  && mv ffmpeg*/ffmpeg /usr/local/bin \
  && rm -rf /tmp/ffmpeg \
  && apk del .build-deps-yarn

RUN apk add --no-cache mediainfo

# Set working directory to function root directory
WORKDIR /function

# Copy in the built dependencies
COPY --from=build-image /function/index.mjs /function
COPY --from=build-image /function/index.mjs.map /function

CMD ["node", "--enable-source-maps", "index.mjs"]
