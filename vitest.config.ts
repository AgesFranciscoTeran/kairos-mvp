import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['engine/test/**/*.test.ts', 'app/src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
