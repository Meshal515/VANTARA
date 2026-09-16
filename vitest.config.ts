import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // اختبارات التكامل تشترك في قاعدة واحدة وUchiyomi واحد: التوازي يفسدها
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 90_000,
    include: ['**/src/**/*.test.ts'],
  },
});
