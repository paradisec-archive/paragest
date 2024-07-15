import { createReadStream, createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';

import {
  S3Client,
  CopyObjectCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  UploadPartCopyCommand,
  type GetObjectCommandInput,
} from '@aws-sdk/client-s3';

import { Upload } from '@aws-sdk/lib-storage';

const s3 = new S3Client();

const bigCopy = async (srcBucket: string, src: string, dstBucket: string, dst: string, objectSize: number) => {
  const partSize = 100 * 1024 * 1024;
  let uploadId: string | undefined;

  const createMultipartUploadResult = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: dstBucket,
      Key: dst,
    }),
  );
  uploadId = createMultipartUploadResult.UploadId;

  const numParts = Math.ceil(objectSize / partSize);

  const promises = [];
  for (let partNumber = 1; partNumber <= numParts; partNumber += 1) {
    const start = (partNumber - 1) * partSize;
    const end = partNumber * partSize - 1;
    const copySourceRange = `bytes=${start}-${end > objectSize ? objectSize - 1 : end}`;
    console.debug(`Copying part ${partNumber} with range ${copySourceRange}`);

    const cmd = new UploadPartCopyCommand({
      Bucket: dstBucket,
      CopySource: encodeURIComponent(`${srcBucket}/${src}`).replace(/%20/g, '+'),
      CopySourceRange: copySourceRange,
      Key: dst,
      PartNumber: partNumber,
      UploadId: uploadId,
    });

    const promise = s3.send(cmd).then((result) => {
      console.debug(result, partNumber);
      if (!result.CopyPartResult?.ETag) {
        throw new Error('Checksum missing MOO3');
      }

      return {
        ETag: result.CopyPartResult?.ETag,
        PartNumber: partNumber,
      };
    });

    promises.push(promise);
  }

  const copyResults = await Promise.all(promises);

  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: dstBucket,
      Key: dst,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: copyResults,
      },
    }),
  );
};

export const copy = async (srcBucket: string, src: string, dstBucket: string, dst: string) => {
  const headObject = await s3.send(
    new HeadObjectCommand({
      Bucket: srcBucket,
      Key: src,
    }),
  );

  const objectSize = headObject.ContentLength || 0;
  const partSize = 5 * 1024 * 1024 * 1024;

  if (objectSize < partSize) {
    console.debug(`Small Copying ${srcBucket}:${src} to ${dstBucket}:${dst}`);
    const copyCommand = new CopyObjectCommand({
      CopySource: `${srcBucket}/${src}`,
      Bucket: dstBucket,
      Key: dst,
      ChecksumAlgorithm: 'SHA256',
    });
    await s3.send(copyCommand);
  } else {
    console.debug(`Big Copying ${srcBucket}:${src} to ${dstBucket}:${dst}`);
    await bigCopy(srcBucket, src, dstBucket, dst, objectSize);
  }
};

export const destroy = async (bucket: string, key: string) => {
  console.debug(`Deleting ${bucket}:${key}`);
  const deleteCommand = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  await s3.send(deleteCommand);
};

export const move = async (srcBucket: string, src: string, dstBucket: string, dst: string) => {
  await copy(srcBucket, src, dstBucket, dst);

  await destroy(srcBucket, src);
};

export const upload = async (filename: string, dstBucket: string, dst: string, mimetype: string) => {
  const readStream = createReadStream(filename);

  await new Upload({
    client: s3,
    params: {
      Bucket: dstBucket,
      Key: dst,
      Body: readStream,
      ContentType: mimetype,
      ChecksumAlgorithm: 'SHA256',
    },
    partSize: 100 * 1024 * 1024,
  }).done();
};

export const download = async (srcBucket: string, src: string, filename: string, options: { range?: string } = {}) => {
  const params: GetObjectCommandInput = {
    Bucket: srcBucket,
    Key: src,
  }
  if (options.range) {
    params.Range = options.range;
  }
  const getCommand = new GetObjectCommand(params);
  const { Body } = await s3.send(getCommand);

  const writeStream = createWriteStream(filename);

  await new Promise((resolve, reject) => {
    (Body as Readable).pipe(writeStream).on('error', reject).on('finish', resolve);
  });
};

export const list = async (bucketName: string, prefix: string) => {
  const listCommand = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
  });

  const response = await s3.send(listCommand);

  return response.Contents || [];
};
