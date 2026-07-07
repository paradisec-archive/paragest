import { afterEach, describe, expect, it, vi } from 'vitest';

const loadConfig = async () => {
  vi.resetModules();
  const { default: config } = await import('./codegen.ts');
  return config;
};

describe('codegen config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to the production schema URL', async () => {
    vi.stubEnv('CODEGEN_SCHEMA', undefined);

    const config = await loadConfig();

    expect(config.schema).toBe('https://admin-catalog.paradisec.org.au/paradisec.graphql');
  });

  it('uses CODEGEN_SCHEMA as the schema location when set', async () => {
    vi.stubEnv('CODEGEN_SCHEMA', '/tmp/nabu-schema.graphql');

    const config = await loadConfig();

    expect(config.schema).toBe('/tmp/nabu-schema.graphql');
  });
});
