ARG FUNCTION_DIR="/function"

FROM node:lts-alpine as build-image

ARG FUNCTION_DIR

RUN mkdir -p ${FUNCTION_DIR}/video ${FUNCTION_DIR}/lib
COPY .yarnrc.yml ${FUNCTION_DIR}
COPY package.json ${FUNCTION_DIR}
COPY yarn.lock ${FUNCTION_DIR}

WORKDIR /function
RUN corepack enable
RUN yarn --immutable

RUN ls

COPY src/video/create-archival.ts ${FUNCTION_DIR}/video/
COPY src/lib/*.ts ${FUNCTION_DIR}/lib/

RUN echo  /
RUN ls  /
RUN echo  /function
RUN ls node_modules
RUN ls node_modules/@sentry
RUN ls node_modules/@sentry/node

RUN ./node_modules/.bin/esbuild \
  --bundle video/create-archival.ts \
  --target=node20 \
  --platform=node \
  --outfile=index.js \
  --minify \
  --sourcemap=external \
  --sources-content=true

FROM node:lts-alpine

ARG FUNCTION_DIR

ARG ffmpegURL=https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz

RUN apk add --no-cache --virtual .build-deps-yarn wget \
  && mkdir /tmp/ffmpeg \
  && cd /tmp/ffmpeg \
  && wget -O ffmpeg.tar.xz ${ffmpegURL} \
  && tar -xf ffmpeg.tar.xz \
  && mv ffmpeg*/ffmpeg /usr/local/bin \
  && rm -rf /tmp/ffmpeg \
  && apk del .build-deps-yarn

RUN apk add mediainfo

# Set working directory to function root directory
WORKDIR ${FUNCTION_DIR}

# Copy in the built dependencies
COPY --from=build-image ${FUNCTION_DIR}/index.js ${FUNCTION_DIR}
COPY --from=build-image ${FUNCTION_DIR}/index.js.map ${FUNCTION_DIR}

CMD ["node", "--enable-source-maps", "index.js"]
