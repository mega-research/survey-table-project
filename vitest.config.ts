import react from '@vitejs/plugin-react';
import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

// 전체 스위트에서만 간섭으로 깨지는 알려진 flaky — 단독 실행은 항상 통과.
// (tests/integration/profiles-row-actions: 전체 실행 시 타 파일 모킹 간섭으로 12건 실패)
const ISOLATED_FLAKY_TESTS = ['tests/integration/profiles-row-actions.test.ts'];

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
    // RUN_FLAKY_ISOLATED=1 이면 "전체 스위트에서만 간섭으로 깨지는" 격리 대상 파일만 단독 실행.
    // pnpm test 가 [본 스위트(격리 대상 제외) → 격리 대상 단독] 2단으로 돌려 커버리지는 유지하면서
    // flaky 로 CI 가 상시 빨간불이 되는 것을 막는다. 근본 원인(전체 실행 시 모킹 간섭)을 고치면
    // ISOLATED_FLAKY_TESTS 에서 제거할 것.
    include:
      process.env['RUN_REALDB'] === '1'
        ? ['tests/integration/**/*.realdb.test.ts']
        : process.env['RUN_FLAKY_ISOLATED'] === '1'
          ? ISOLATED_FLAKY_TESTS
          : ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'workers/**/*.test.{ts,tsx}'],
    exclude:
      process.env['RUN_REALDB'] === '1'
        ? [...configDefaults.exclude]
        : [
            ...configDefaults.exclude,
            '**/*.realdb.test.ts',
            ...(process.env['RUN_FLAKY_ISOLATED'] === '1' ? [] : ISOLATED_FLAKY_TESTS),
          ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/spss/**', 'src/lib/analytics/spss-*'],
    },
  },
});
