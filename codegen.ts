import type { CodegenConfig } from '@graphql-codegen/cli'; // eslint-disable-line import/no-extraneous-dependencies

const config: CodegenConfig = {
  schema: 'https://catalog.nabu-stage.paradisec.org.au/paradisec.graphql',
  documents: ['src/**/*.ts'],
  ignoreNoDocuments: true, // for better experience with the watcher
  generates: {
    './src/gql/': {
      preset: 'client',
      plugins: [],
    },
  },
};

export default config;
