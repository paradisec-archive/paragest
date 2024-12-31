FROM public.ecr.aws/amazonlinux/amazonlinux:2023

# NOTE: This is where cdk expects to find everything, lambda will dump it into opt
RUN mkdir -p /asset/bin /asset/lib /asset/share

RUN dnf groupinstall -y "Development Tools" && \
  dnf install -y wget tar gzip libjpeg-turbo-devel openjpeg2-devel zlib-devel xz-devel \
  bzip2-devel libexif-devel libpng-devel libtiff-devel libwebp-devel && \
  dnf clean

ARG magickURL=https://imagemagick.org/archive/ImageMagick.tar.gz
RUN wget -qO ImageMagick.tar.gz ${magickURL}
RUN tar xf ImageMagick.tar.gz && \
  cd ImageMagick-* \
  && ./configure \
  --prefix=/asset \
  --disable-shared \
  --enable-static \
  --disable-openmp \
  --without-modules \
  --without-magick-plus-plus \
  --without-perl \
  --without-dps \
  --without-fpx \
  --without-freetype \
  --without-fontconfig \
  --without-gslib \
  --without-lcms \
  --without-lcms2 \
  --without-xml \
  --without-x \
  --enable-delegate-build \
  --disable-dependency-tracking \
  --disable-dpc \
  --disable-docs \
  --without-dmr \
  --disable-opencl \
  --without-pango \
  --without-openexr \
  && make -j 12 \
  && make install-exec

# No symlinks in zip file so try to make it smaler
RUN cd /asset/bin && rm animate conjure montage stream && \
  cp \
  /lib64/libtiff.so.5 \
  /lib64/libjpeg.so.62 \
  /lib64/libpng16.so.16 \
  /lib64/libwebpmux.so.3 \
  /lib64/libwebpdemux.so.2 \
  /lib64/libwebp.so.7 \
  /lib64/liblzma.so.5 \
  /lib64/libbz2.so.1 \
  /lib64/libopenjp2.so.7 \
  /lib64/libz.so.1 \
  /lib64/libzstd.so.1 \
  /lib64/libjbig.so.2.1 \
  /asset/lib
