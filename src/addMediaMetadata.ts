import type { Handler } from 'aws-lambda';
import { fileTypeFromTokenizer } from 'file-type/core';
import { makeTokenizer } from '@tokenizer/s3';
import { S3Client } from '@aws-sdk/client-s3';

import { graphql } from './gql';

import { StepError } from './lib/errors.js';
import { getGraphQLClient } from './lib/graphql.js';
import { Essence, EssenceAttributes } from './gql/graphql';

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

const gqlClient = await getGraphQLClient();

const getFiletype = async (bucketName: string, objectKey: string) => {
  const s3Tokenizer = await makeTokenizer(s3, {
    Bucket: bucketName,
    Key: objectKey,
  });

  const fileType = await fileTypeFromTokenizer(s3Tokenizer);

  return fileType;
};

graphql(/* GraphQL */ `
  fragment EssenceItem on Essence {
    id

    filename
    size

    mimetype
    channels
    citation
    duration
    fps
    samplerate

    createdAt
    updatedAt
  }
`);

const getEssence = async (collectionIdentifier: string, itemIdentifier: string, filename: string) => {
  const EssenceQuery = graphql(/* GraphQL */ `
    query GetEssenceQuery($fullIdentifier: ID!, $filename: String!) {
      essence(fullIdentifier: $fullIdentifier, filename: $filename) {
        id
      }
    }
  `);

  const response = await gqlClient.query(EssenceQuery, { fullIdentifier: `${collectionIdentifier}-${itemIdentifier}`, filename });
  console.debug('Response:', JSON.stringify(response, null, 2));

  return response.data?.essence;
};

const createEssence = async (collectionIdentifier: string, itemIdentifier: string, filename: string, attributes: Omit<Essence, 'id'>) => {
  const EssenceCreateMutation = graphql(/* GraphQL */ `
      mutation EssenceCreateMutation($input: EssenceCreateInput!) {
        essenceCreate(input: $input) {
          essence {
            ...EssenceItem
          }
        }
      }
    `);

  const { mimetype, size } = attributes;
  if (!mimetype) {
    throw new Error('Mimetype is required');
  }

  if (!size) {
    throw new Error('Size is required');
  }

  const params = {
    collectionIdentifier,
    itemIdentifier,
    filename,
    attributes: {
      ...attributes,
      mimetype,
      size,
    },
  };

  const createResponse = await gqlClient.mutation(EssenceCreateMutation, { input: params });
  console.debug('CreateResponse:', JSON.stringify(createResponse, null, 2));

  return [createResponse.data?.essenceCreate?.essence, createResponse.error];
};

const updateEssence = async (id: string, attributes: EssenceAttributes) => {
  const EssenceUpdateMutation = graphql(/* GraphQL */ `
    mutation EssenceUpdateMutation($input: EssenceUpdateInput!) {
      essenceUpdate(input: $input) {
        essence {
          ...EssenceItem
        }
      }
    }
  `);

  const params = {
    id,
    attributes,
  };

  const createResponse = await gqlClient.mutation(EssenceUpdateMutation, { input: params });
  console.debug('CreateResponse:', JSON.stringify(createResponse, null, 2));

  return [createResponse.data?.essenceUpdate?.essence, createResponse.error];
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
    objectSize,
  } = event;

  const filetype = await getFiletype(bucketName, objectKey);
  console.debug(filetype);
  if (!filetype) {
    throw new StepError(`${filename}: Couldn't determine filetype`, event, event);
  }

  if (filetype.ext !== extension) {
    throw new StepError(`${filename}: File extension doesn't match detected filetype ${filetype.ext}`, event, event);
  }

  const essence = await getEssence(collectionIdentifier, itemIdentifier, filename);
  console.debug(essence);

  const attributes = {
    mimetype: filetype.mime,
    size: objectSize,
  };

  if (essence) {
    const [updatedEssence, error] = await updateEssence(essence.id, attributes);
    if (!updatedEssence) {
      throw new StepError(`${filename}: Couldn't update essence`, event, { ...event, error });
    }
  } else {
    const [createdEssence, error] = await createEssence(collectionIdentifier, itemIdentifier, filename, attributes);
    if (!createdEssence) {
      throw new StepError(`${filename}: Couldn't create essence`, event, { ...event, error });
    }
  }
};
