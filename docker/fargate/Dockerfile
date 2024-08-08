FROM node:lts-alpine as build-image

ARG SOURCE_FILE

WORKDIR /function

RUN mkdir -p /function/video /function/lib

COPY .yarnrc.yml /function
COPY package.json /function
COPY yarn.lock /function


RUN corepack enable
RUN yarn --immutable

RUN ls

COPY src/${SOURCE_FILE} /function/video/
COPY src/lib/*.ts /function/lib/

RUN echo  /
RUN ls  /
RUN echo  /function
RUN ls node_modules
RUN ls node_modules/@sentry
RUN ls node_modules/@sentry/node

RUN ./node_modules/.bin/esbuild \
  --bundle ${SOURCE_FILE} \
  --target=node20 \
  --platform=node \
  --outfile=index.js \
  --sourcemap \
  --sources-content=true
# --minify \

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
WORKDIR /function

# Copy in the built dependencies
COPY --from=build-image /function/index.js /function
COPY --from=build-image /function/index.js.map /function

CMD ["node", "--enable-source-maps", "index.js"]
