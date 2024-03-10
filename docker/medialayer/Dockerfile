FROM ubuntu:latest

# NOTE: We don't care about docker images size as we are copying out of it, we prefer faster builds

# NOTE: This is where cdk expects to find everything, lambda will dump it into opt
RUN mkdir -p /asset/bin /asset/lib /asset/share

RUN apt-get update
RUN apt-get install -y --no-install-recommends wget unzip rpm2cpio cpio xz-utils ca-certificates

ARG MEDIA_INFO_VERSION=23.11
ARG mediaInfoURL=https://mediaarea.net/download/binary/mediainfo/${MEDIA_INFO_VERSION}/MediaInfo_CLI_${MEDIA_INFO_VERSION}_Lambda_x86_64.zip
RUN wget -O mediainfo.zip ${mediaInfoURL}
RUN unzip mediainfo.zip bin/mediainfo -d /asset

ARG BWF_METAEDIT_VERSION=23.04
ARG bwfMetaEditURL=https://mediaarea.net/download/binary/bwfmetaedit/${BWF_METAEDIT_VERSION}/bwfmetaedit-${BWF_METAEDIT_VERSION}.x86_64.CentOS_7.rpm
RUN wget -O bwfmetaedit.rpm ${bwfMetaEditURL}
RUN rpm2cpio bwfmetaedit.rpm | cpio -id
RUN mv usr/bin/bwfmetaedit /asset/bin

ARG ffmpegURL=https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
RUN wget -O ffmpeg.tar.xz ${ffmpegURL}
RUN tar -xf ffmpeg.tar.xz
RUN mv ffmpeg*/ffmpeg /asset/bin
