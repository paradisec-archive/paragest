/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** An ISO 8601-encoded datetime */
  ISO8601DateTime: { input: any; output: any; }
};

export type AccessCondition = {
  __typename?: 'AccessCondition';
  collections?: Maybe<Array<Maybe<Collection>>>;
  items?: Maybe<Array<Maybe<Item>>>;
  name?: Maybe<Scalars['String']['output']>;
};

export type Agent = {
  __typename?: 'Agent';
  role_name?: Maybe<Scalars['String']['output']>;
  user?: Maybe<Person>;
  user_name?: Maybe<Scalars['String']['output']>;
};

export type Boundary = {
  __typename?: 'Boundary';
  east_limit: Scalars['Float']['output'];
  north_limit: Scalars['Float']['output'];
  south_limit: Scalars['Float']['output'];
  west_limit: Scalars['Float']['output'];
};

export type Collection = {
  __typename?: 'Collection';
  access_class?: Maybe<Scalars['String']['output']>;
  access_narrative?: Maybe<Scalars['String']['output']>;
  boundaries?: Maybe<Boundary>;
  citation?: Maybe<Scalars['String']['output']>;
  collector?: Maybe<Person>;
  comments?: Maybe<Scalars['String']['output']>;
  complete?: Maybe<Scalars['Boolean']['output']>;
  content_languages?: Maybe<Array<Maybe<Language>>>;
  countries?: Maybe<Array<Maybe<Country>>>;
  description?: Maybe<Scalars['String']['output']>;
  doi?: Maybe<Scalars['String']['output']>;
  doi_xml?: Maybe<Scalars['String']['output']>;
  field_of_research?: Maybe<FieldOfResearch>;
  grants?: Maybe<Array<Maybe<Grant>>>;
  id: Scalars['ID']['output'];
  identifier: Scalars['String']['output'];
  media?: Maybe<Scalars['String']['output']>;
  metadata_source?: Maybe<Scalars['String']['output']>;
  operator?: Maybe<Person>;
  orthographic_notes?: Maybe<Scalars['String']['output']>;
  permalink: Scalars['String']['output'];
  region?: Maybe<Scalars['String']['output']>;
  subject_languages?: Maybe<Array<Maybe<Language>>>;
  tape_location?: Maybe<Scalars['Boolean']['output']>;
  title: Scalars['String']['output'];
  university?: Maybe<University>;
};

export type Country = {
  __typename?: 'Country';
  boundaries?: Maybe<Array<Maybe<Boundary>>>;
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  languages?: Maybe<Array<Maybe<Language>>>;
  name: Scalars['String']['output'];
};

export type DataCategory = {
  __typename?: 'DataCategory';
  id: Scalars['ID']['output'];
  items?: Maybe<Array<Maybe<Item>>>;
  name: Scalars['String']['output'];
};

export type DataType = {
  __typename?: 'DataType';
  id: Scalars['ID']['output'];
  items?: Maybe<Array<Maybe<Item>>>;
  name: Scalars['String']['output'];
};

export type DiscourseType = {
  __typename?: 'DiscourseType';
  id: Scalars['ID']['output'];
  items?: Maybe<Array<Maybe<Item>>>;
  name: Scalars['String']['output'];
};

export type EmailUser = {
  __typename?: 'EmailUser';
  email?: Maybe<Scalars['String']['output']>;
  firstName?: Maybe<Scalars['String']['output']>;
  lastName?: Maybe<Scalars['String']['output']>;
};

export type Essence = {
  __typename?: 'Essence';
  bitrate?: Maybe<Scalars['Int']['output']>;
  channels?: Maybe<Scalars['Int']['output']>;
  citation?: Maybe<Scalars['String']['output']>;
  collection?: Maybe<Collection>;
  collectionId?: Maybe<Scalars['Int']['output']>;
  createdAt?: Maybe<Scalars['ISO8601DateTime']['output']>;
  derivedFilesGenerated?: Maybe<Scalars['Boolean']['output']>;
  doi?: Maybe<Scalars['String']['output']>;
  doi_xml?: Maybe<Scalars['String']['output']>;
  duration?: Maybe<Scalars['Float']['output']>;
  filename?: Maybe<Scalars['String']['output']>;
  fps?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  item?: Maybe<Item>;
  itemId?: Maybe<Scalars['Int']['output']>;
  mimetype?: Maybe<Scalars['String']['output']>;
  permalink?: Maybe<Scalars['String']['output']>;
  samplerate?: Maybe<Scalars['Int']['output']>;
  size?: Maybe<Scalars['Int']['output']>;
  updatedAt?: Maybe<Scalars['ISO8601DateTime']['output']>;
};

/** Attributes for creating or updating an essence */
export type EssenceAttributes = {
  bitrate?: InputMaybe<Scalars['Int']['input']>;
  channels?: InputMaybe<Scalars['Int']['input']>;
  duration?: InputMaybe<Scalars['Float']['input']>;
  fps?: InputMaybe<Scalars['Int']['input']>;
  mimetype: Scalars['String']['input'];
  samplerate?: InputMaybe<Scalars['Int']['input']>;
  size: Scalars['Int']['input'];
};

/** Autogenerated input type of EssenceCreate */
export type EssenceCreateInput = {
  attributes: EssenceAttributes;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  collectionIdentifier: Scalars['String']['input'];
  filename: Scalars['String']['input'];
  itemIdentifier: Scalars['String']['input'];
};

/** Autogenerated return type of EssenceCreate. */
export type EssenceCreatePayload = {
  __typename?: 'EssenceCreatePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  essence: Essence;
};

/** Autogenerated input type of EssenceUpdate */
export type EssenceUpdateInput = {
  attributes: EssenceAttributes;
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
};

/** Autogenerated return type of EssenceUpdate. */
export type EssenceUpdatePayload = {
  __typename?: 'EssenceUpdatePayload';
  /** A unique identifier for the client performing the mutation. */
  clientMutationId?: Maybe<Scalars['String']['output']>;
  essence: Essence;
};

export type FieldOfResearch = {
  __typename?: 'FieldOfResearch';
  collections?: Maybe<Array<Maybe<Collection>>>;
  id: Scalars['ID']['output'];
  identifier: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type FundingBody = {
  __typename?: 'FundingBody';
  funded_collections?: Maybe<Array<Maybe<Collection>>>;
  grants?: Maybe<Array<Maybe<Grant>>>;
  id: Scalars['ID']['output'];
  key_prefix?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
};

export type Grant = {
  __typename?: 'Grant';
  collection?: Maybe<Collection>;
  funding_body?: Maybe<FundingBody>;
  id: Scalars['ID']['output'];
  identifier?: Maybe<Scalars['String']['output']>;
};

export type Item = {
  __typename?: 'Item';
  access_class?: Maybe<Scalars['String']['output']>;
  access_condition?: Maybe<AccessCondition>;
  access_condition_name?: Maybe<Scalars['String']['output']>;
  access_narrative?: Maybe<Scalars['String']['output']>;
  born_digital?: Maybe<Scalars['Boolean']['output']>;
  boundaries?: Maybe<Boundary>;
  citation?: Maybe<Scalars['String']['output']>;
  collection: Collection;
  collector: Person;
  content_languages?: Maybe<Array<Maybe<Language>>>;
  countries?: Maybe<Array<Maybe<Country>>>;
  created_at?: Maybe<Scalars['ISO8601DateTime']['output']>;
  data_categories?: Maybe<Array<Maybe<DataCategory>>>;
  data_types?: Maybe<Array<Maybe<DataType>>>;
  description?: Maybe<Scalars['String']['output']>;
  dialect?: Maybe<Scalars['String']['output']>;
  digitised_on?: Maybe<Scalars['String']['output']>;
  discourse_type?: Maybe<DiscourseType>;
  doi?: Maybe<Scalars['String']['output']>;
  doi_xml?: Maybe<Scalars['String']['output']>;
  essences?: Maybe<Array<Maybe<Essence>>>;
  essences_count?: Maybe<Scalars['Int']['output']>;
  full_identifier: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  identifier: Scalars['String']['output'];
  ingest_notes?: Maybe<Scalars['String']['output']>;
  item_agents?: Maybe<Array<Maybe<Agent>>>;
  language?: Maybe<Scalars['String']['output']>;
  metadata_exportable: Scalars['Boolean']['output'];
  operator?: Maybe<Person>;
  original_media?: Maybe<Scalars['String']['output']>;
  originated_on?: Maybe<Scalars['String']['output']>;
  originated_on_narrative?: Maybe<Scalars['String']['output']>;
  permalink: Scalars['String']['output'];
  private?: Maybe<Scalars['Boolean']['output']>;
  public?: Maybe<Scalars['Boolean']['output']>;
  received_on?: Maybe<Scalars['String']['output']>;
  region?: Maybe<Scalars['String']['output']>;
  subject_languages?: Maybe<Array<Maybe<Language>>>;
  title?: Maybe<Scalars['String']['output']>;
  tracking?: Maybe<Scalars['String']['output']>;
  university?: Maybe<University>;
  updated_at?: Maybe<Scalars['ISO8601DateTime']['output']>;
};

export type ItemResult = {
  __typename?: 'ItemResult';
  next_page?: Maybe<Scalars['Int']['output']>;
  results: Array<Maybe<Item>>;
  total: Scalars['Int']['output'];
};

export type Language = {
  __typename?: 'Language';
  archive_link?: Maybe<Scalars['String']['output']>;
  code: Scalars['String']['output'];
  collection?: Maybe<Array<Maybe<Collection>>>;
  countries?: Maybe<Array<Maybe<Country>>>;
  id: Scalars['ID']['output'];
  items_for_content?: Maybe<Array<Maybe<Item>>>;
  items_for_language?: Maybe<Array<Maybe<Item>>>;
  name: Scalars['String']['output'];
  retired?: Maybe<Scalars['Boolean']['output']>;
};

export type Mutation = {
  __typename?: 'Mutation';
  /** Creates a new essence */
  essenceCreate?: Maybe<EssenceCreatePayload>;
  /** Updates a essence by id */
  essenceUpdate?: Maybe<EssenceUpdatePayload>;
};


export type MutationEssenceCreateArgs = {
  input: EssenceCreateInput;
};


export type MutationEssenceUpdateArgs = {
  input: EssenceUpdateInput;
};

export type Person = {
  __typename?: 'Person';
  collected_items?: Maybe<Item>;
  country?: Maybe<Scalars['String']['output']>;
  first_name?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  last_name?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
};

export type Query = {
  __typename?: 'Query';
  /** Find a collection by identifier. e.g. NT1 */
  collection?: Maybe<Collection>;
  /** Find a collection by identifier. e.g. NT1 */
  essence?: Maybe<Essence>;
  /** Find an item by full identifier. e.g. NT1-009 */
  item?: Maybe<Item>;
  items?: Maybe<ItemResult>;
  /** Find a user by their unikey */
  userByUnikey?: Maybe<EmailUser>;
};


export type QueryCollectionArgs = {
  identifier: Scalars['ID']['input'];
};


export type QueryEssenceArgs = {
  filename: Scalars['String']['input'];
  fullIdentifier: Scalars['ID']['input'];
};


export type QueryItemArgs = {
  fullIdentifier: Scalars['ID']['input'];
};


export type QueryItemsArgs = {
  access_class?: InputMaybe<Scalars['String']['input']>;
  access_condition_name?: InputMaybe<Scalars['String']['input']>;
  access_narrative?: InputMaybe<Scalars['String']['input']>;
  born_digital?: InputMaybe<Scalars['Boolean']['input']>;
  collection_identifier?: InputMaybe<Scalars['String']['input']>;
  collector_name?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  dialect?: InputMaybe<Scalars['String']['input']>;
  digitised_on?: InputMaybe<Scalars['String']['input']>;
  discourse_type_name?: InputMaybe<Scalars['String']['input']>;
  doi?: InputMaybe<Scalars['String']['input']>;
  essences_count?: InputMaybe<Scalars['Int']['input']>;
  full_identifier?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  identifier?: InputMaybe<Scalars['String']['input']>;
  ingest_notes?: InputMaybe<Scalars['String']['input']>;
  language?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  operator_name?: InputMaybe<Scalars['String']['input']>;
  original_media?: InputMaybe<Scalars['String']['input']>;
  originated_on?: InputMaybe<Scalars['String']['input']>;
  originated_on_narrative?: InputMaybe<Scalars['String']['input']>;
  page?: InputMaybe<Scalars['Int']['input']>;
  private?: InputMaybe<Scalars['Boolean']['input']>;
  received_on?: InputMaybe<Scalars['String']['input']>;
  region?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
  tracking?: InputMaybe<Scalars['String']['input']>;
  university_name?: InputMaybe<Scalars['String']['input']>;
};


export type QueryUserByUnikeyArgs = {
  unikey: Scalars['String']['input'];
};

export type University = {
  __typename?: 'University';
  collections?: Maybe<Array<Maybe<Collection>>>;
  id: Scalars['ID']['output'];
  items?: Maybe<Array<Maybe<Item>>>;
  name: Scalars['String']['output'];
  party_identifier?: Maybe<Scalars['String']['output']>;
};

export type EssenceItemFragment = { __typename?: 'Essence', id: string, filename?: string | null, size?: number | null, mimetype?: string | null, channels?: number | null, citation?: string | null, duration?: number | null, fps?: number | null, bitrate?: number | null, samplerate?: number | null, createdAt?: any | null, updatedAt?: any | null } & { ' $fragmentName'?: 'EssenceItemFragment' };

export type GetEssenceQueryQueryVariables = Exact<{
  fullIdentifier: Scalars['ID']['input'];
  filename: Scalars['String']['input'];
}>;


export type GetEssenceQueryQuery = { __typename?: 'Query', essence?: { __typename?: 'Essence', id: string } | null };

export type EssenceCreateMutationMutationVariables = Exact<{
  input: EssenceCreateInput;
}>;


export type EssenceCreateMutationMutation = { __typename?: 'Mutation', essenceCreate?: { __typename?: 'EssenceCreatePayload', essence: (
      { __typename?: 'Essence' }
      & { ' $fragmentRefs'?: { 'EssenceItemFragment': EssenceItemFragment } }
    ) } | null };

export type EssenceUpdateMutationMutationVariables = Exact<{
  input: EssenceUpdateInput;
}>;


export type EssenceUpdateMutationMutation = { __typename?: 'Mutation', essenceUpdate?: { __typename?: 'EssenceUpdatePayload', essence: (
      { __typename?: 'Essence' }
      & { ' $fragmentRefs'?: { 'EssenceItemFragment': EssenceItemFragment } }
    ) } | null };

export type GetItemQueryQueryVariables = Exact<{
  fullIdentifier: Scalars['ID']['input'];
}>;


export type GetItemQueryQuery = { __typename?: 'Query', item?: { __typename?: 'Item', full_identifier: string, title?: string | null, metadata_exportable: boolean, created_at?: any | null, updated_at?: any | null } | null };

export type GetUserByUnikeyQueryQueryVariables = Exact<{
  unikey: Scalars['String']['input'];
}>;


export type GetUserByUnikeyQueryQuery = { __typename?: 'Query', userByUnikey?: { __typename?: 'EmailUser', email?: string | null, firstName?: string | null, lastName?: string | null } | null };

export const EssenceItemFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EssenceItem"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Essence"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"filename"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"mimetype"}},{"kind":"Field","name":{"kind":"Name","value":"channels"}},{"kind":"Field","name":{"kind":"Name","value":"citation"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"fps"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}},{"kind":"Field","name":{"kind":"Name","value":"samplerate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<EssenceItemFragment, unknown>;
export const GetEssenceQueryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetEssenceQuery"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"fullIdentifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filename"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"essence"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"fullIdentifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"fullIdentifier"}}},{"kind":"Argument","name":{"kind":"Name","value":"filename"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filename"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<GetEssenceQueryQuery, GetEssenceQueryQueryVariables>;
export const EssenceCreateMutationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"EssenceCreateMutation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EssenceCreateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"essenceCreate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"essence"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EssenceItem"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EssenceItem"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Essence"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"filename"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"mimetype"}},{"kind":"Field","name":{"kind":"Name","value":"channels"}},{"kind":"Field","name":{"kind":"Name","value":"citation"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"fps"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}},{"kind":"Field","name":{"kind":"Name","value":"samplerate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<EssenceCreateMutationMutation, EssenceCreateMutationMutationVariables>;
export const EssenceUpdateMutationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"EssenceUpdateMutation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EssenceUpdateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"essenceUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"essence"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"EssenceItem"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"EssenceItem"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Essence"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"filename"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"mimetype"}},{"kind":"Field","name":{"kind":"Name","value":"channels"}},{"kind":"Field","name":{"kind":"Name","value":"citation"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"fps"}},{"kind":"Field","name":{"kind":"Name","value":"bitrate"}},{"kind":"Field","name":{"kind":"Name","value":"samplerate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<EssenceUpdateMutationMutation, EssenceUpdateMutationMutationVariables>;
export const GetItemQueryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetItemQuery"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"fullIdentifier"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"item"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"fullIdentifier"},"value":{"kind":"Variable","name":{"kind":"Name","value":"fullIdentifier"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"full_identifier"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"metadata_exportable"}},{"kind":"Field","name":{"kind":"Name","value":"created_at"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}}]}}]}}]} as unknown as DocumentNode<GetItemQueryQuery, GetItemQueryQueryVariables>;
export const GetUserByUnikeyQueryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetUserByUnikeyQuery"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"unikey"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userByUnikey"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"unikey"},"value":{"kind":"Variable","name":{"kind":"Name","value":"unikey"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"firstName"}},{"kind":"Field","name":{"kind":"Name","value":"lastName"}}]}}]}}]} as unknown as DocumentNode<GetUserByUnikeyQueryQuery, GetUserByUnikeyQueryQueryVariables>;