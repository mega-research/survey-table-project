import react from '@vitejs/plugin-react';
import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Next.js `server-only` 마커 stub — vitest 환경에서 resolve 불가하므로 빈 모듈로 대체.
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // RUN_REALDB=1(pnpm test:integration) 이면 실 DB 왕복 테스트만, 아니면 일반 테스트(realdb 제외)
    include:
      process.env['RUN_REALDB'] === '1'
        ? ['tests/integration/**/*.realdb.test.ts']
        : ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'workers/**/*.test.{ts,tsx}'],
    exclude:
      process.env['RUN_REALDB'] === '1'
        ? [...configDefaults.exclude]
        : [...configDefaults.exclude, '**/*.realdb.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/spss/**', 'src/lib/analytics/spss-*'],
    },
  },
});
