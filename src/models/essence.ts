import { graphql } from '../gql';

import { getGraphQLClient } from '../lib/graphql.js';
import { Essence, EssenceAttributes } from '../gql/graphql';

const gqlClient = await getGraphQLClient();

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

export const getEssence = async (collectionIdentifier: string, itemIdentifier: string, filename: string) => {
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

export const createEssence = async (collectionIdentifier: string, itemIdentifier: string, filename: string, attributes: Omit<Essence, 'id'>) => {
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

export const updateEssence = async (id: string, attributes: EssenceAttributes) => {
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
