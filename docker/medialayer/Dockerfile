FROM ubuntu:24.10

SHELL ["/bin/bash", "-exo", "pipefail", "-c"]

# NOTE: This is where cdk expects to find everything, lambda will dump it into opt
RUN mkdir -p /asset/bin /asset/lib /asset/share

RUN apt-get update && \
  apt-get install -y --no-install-recommends wget unzip rpm2cpio cpio xz-utils ca-certificates && \
  rm -rf /var/cache/apt/archives /var/lib/apt/lists/*

ARG MEDIA_INFO_VERSION=23.11
ARG mediaInfoURL=https://mediaarea.net/download/binary/mediainfo/${MEDIA_INFO_VERSION}/MediaInfo_CLI_${MEDIA_INFO_VERSION}_Lambda_x86_64.zip
RUN wget -qO mediainfo.zip ${mediaInfoURL} && \
  unzip mediainfo.zip bin/mediainfo -d /asset

ARG BWF_METAEDIT_VERSION=23.04
ARG bwfMetaEditURL=https://mediaarea.net/download/binary/bwfmetaedit/${BWF_METAEDIT_VERSION}/bwfmetaedit-${BWF_METAEDIT_VERSION}.x86_64.CentOS_7.rpm
RUN wget -qO bwfmetaedit.rpm ${bwfMetaEditURL} && \
  rpm2cpio bwfmetaedit.rpm | cpio -id && \
  mv usr/bin/bwfmetaedit /asset/bin

ARG ffmpegURL=https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
RUN wget -qO ffmpeg.tar.xz ${ffmpegURL} && \
  tar -xf ffmpeg.tar.xz && \
  mv ffmpeg*/ffmpeg /asset/bin
