import type { Handler } from 'aws-lambda';
import { fileTypeFromTokenizer } from 'file-type/core';
import { makeTokenizer } from '@tokenizer/s3';
import { S3Client } from '@aws-sdk/client-s3';

import { graphql } from './gql';

import { StepError } from './lib/errors.js';
import { getGraphQLClient } from './lib/graphql.js';

type Event = {
  principalId: string,
  bucketName: string,
  objectKey: string,
  objectSize: number
  details: {
    itemIdentifier: string,
    collectionIdentifier: string,
    filename: string,
    extension: string,
  },
};

const s3 = new S3Client();

//  if (!process.env.PARAGEST_ENV) {
//   throw new Error('PARAGEST_ENV not set');
// }
// const env = process.env.PARAGEST_ENV;

// const destBucket = `nabu-catalog-${env}2`;

const gqlClient = await getGraphQLClient();

const getFiletype = async (bucketName: string, objectKey: string) => {
  const s3Tokenizer = await makeTokenizer(s3, {
    Bucket: bucketName,
    Key: objectKey,
  });

  const fileType = await fileTypeFromTokenizer(s3Tokenizer);

  return fileType;
};

const getEssence = async (collectionIdentifier: string, itemIdentifier: string, filename: string) => {
  const EssenceQuery = graphql(/* GraphQL */ `
    query GetEssenceQuery($fullIdentifier: ID!, $filename: String!) {
      essence(fullIdentifier: $fullIdentifier, filename: $filename) {
        id
        filename
      }
    }
  `);

  const response = await gqlClient.query(EssenceQuery, { fullIdentifier: `${collectionIdentifier}-${itemIdentifier}`, filename });
  console.debug('Response:', JSON.stringify(response, null, 2));

  return response.data?.essence;
};

const createEssence = async (collectionIdentifier: string, itemIdentifier: string, filename: string) => {
  const EssenceCreateMutation = graphql(/* GraphQL */ `
      mutation EssenceCreateMutation($input: EssenceCreateInput!) {
        essenceCreate(input: $input) {
          essence {
            id
            filename
          }
        }
      }
    `);

  const params = {
    essenceInput: {
      collectionIdentifier,
      itemIdentifier,
      filename,
    },
  };

  const createResponse = await gqlClient.mutation(EssenceCreateMutation, { input: params });
  console.debug('CreateResponse:', JSON.stringify(createResponse, null, 2));

  return createResponse.data?.essenceCreate?.essence;
};

export const handler: Handler = async (event: Event) => {
  console.debug('Event:', JSON.stringify(event, null, 2));

  const {
    details: {
      collectionIdentifier,
      itemIdentifier,
      filename,
      extension,
    },
    bucketName,
    objectKey,
  } = event;

  const filetype = await getFiletype(bucketName, objectKey);
  console.debug(filetype);
  if (!filetype) {
    throw new StepError(`${filename}: Couldn't determine filetype`, event, {
      objectKey,
      collectionIdentifier,
      itemIdentifier,
      filename,
    });
  }

  if (filetype.ext !== extension) {
    throw new StepError(`${filename}: File extension doesn't match detected filetype ${filetype.ext}`, event, {
      objectKey,
      collectionIdentifier,
      itemIdentifier,
      filename,
    });
  }

  const essence = await getEssence(collectionIdentifier, itemIdentifier, filename);
  console.debug(essence);

  const createdEssence = await createEssence(collectionIdentifier, itemIdentifier, filename);
  if (!createdEssence) {
    throw new StepError(`${filename}: Couldn't create essence`, event, {
      objectKey,
      collectionIdentifier,
      itemIdentifier,
      filename,
    });
  }
};
