import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  // Point CODEGEN_SCHEMA at a local schema dump to generate against a not-yet-deployed nabu schema
  schema: process.env.CODEGEN_SCHEMA ?? 'https://admin-catalog.paradisec.org.au/paradisec.graphql',
  documents: ['src/**/*.ts'],
  ignoreNoDocuments: true, // for better experience with the watcher
  generates: {
    './src/gql/': {
      preset: 'client',
      config: {
        useTypeImports: true,
      },
    },
  },
};

export default config;
