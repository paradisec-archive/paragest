import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests are colocated with the code they cover
    include: ['**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'cdk.out/**'],
  },
});
