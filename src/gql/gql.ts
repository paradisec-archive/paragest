/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 */
const documents = {
    "\n  fragment EssenceItem on Essence {\n    id\n\n    filename\n    size\n\n    mimetype\n    channels\n    citation\n    duration\n    fps\n    samplerate\n\n    createdAt\n    updatedAt\n  }\n": types.EssenceItemFragmentDoc,
    "\n    query GetEssenceQuery($fullIdentifier: ID!, $filename: String!) {\n      essence(fullIdentifier: $fullIdentifier, filename: $filename) {\n        id\n      }\n    }\n  ": types.GetEssenceQueryDocument,
    "\n      mutation EssenceCreateMutation($input: EssenceCreateInput!) {\n        essenceCreate(input: $input) {\n          essence {\n            ...EssenceItem\n          }\n        }\n      }\n    ": types.EssenceCreateMutationDocument,
    "\n    mutation EssenceUpdateMutation($input: EssenceUpdateInput!) {\n      essenceUpdate(input: $input) {\n        essence {\n          ...EssenceItem\n        }\n      }\n    }\n  ": types.EssenceUpdateMutationDocument,
    "\n    query GetItemQuery($fullIdentifier: ID!) {\n      item(fullIdentifier: $fullIdentifier) {\n        full_identifier\n        title\n      }\n    }\n  ": types.GetItemQueryDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment EssenceItem on Essence {\n    id\n\n    filename\n    size\n\n    mimetype\n    channels\n    citation\n    duration\n    fps\n    samplerate\n\n    createdAt\n    updatedAt\n  }\n"): (typeof documents)["\n  fragment EssenceItem on Essence {\n    id\n\n    filename\n    size\n\n    mimetype\n    channels\n    citation\n    duration\n    fps\n    samplerate\n\n    createdAt\n    updatedAt\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n    query GetEssenceQuery($fullIdentifier: ID!, $filename: String!) {\n      essence(fullIdentifier: $fullIdentifier, filename: $filename) {\n        id\n      }\n    }\n  "): (typeof documents)["\n    query GetEssenceQuery($fullIdentifier: ID!, $filename: String!) {\n      essence(fullIdentifier: $fullIdentifier, filename: $filename) {\n        id\n      }\n    }\n  "];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n      mutation EssenceCreateMutation($input: EssenceCreateInput!) {\n        essenceCreate(input: $input) {\n          essence {\n            ...EssenceItem\n          }\n        }\n      }\n    "): (typeof documents)["\n      mutation EssenceCreateMutation($input: EssenceCreateInput!) {\n        essenceCreate(input: $input) {\n          essence {\n            ...EssenceItem\n          }\n        }\n      }\n    "];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n    mutation EssenceUpdateMutation($input: EssenceUpdateInput!) {\n      essenceUpdate(input: $input) {\n        essence {\n          ...EssenceItem\n        }\n      }\n    }\n  "): (typeof documents)["\n    mutation EssenceUpdateMutation($input: EssenceUpdateInput!) {\n      essenceUpdate(input: $input) {\n        essence {\n          ...EssenceItem\n        }\n      }\n    }\n  "];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n    query GetItemQuery($fullIdentifier: ID!) {\n      item(fullIdentifier: $fullIdentifier) {\n        full_identifier\n        title\n      }\n    }\n  "): (typeof documents)["\n    query GetItemQuery($fullIdentifier: ID!) {\n      item(fullIdentifier: $fullIdentifier) {\n        full_identifier\n        title\n      }\n    }\n  "];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;