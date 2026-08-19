import react from '@vitejs/plugin-react';
import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

// 전체 스위트에서만 간섭으로 깨지는 알려진 flaky — 단독 실행은 항상 통과.
// (tests/integration/profiles-row-actions: 전체 실행 시 타 파일 모킹 간섭으로 12건 실패)
const ISOLATED_FLAKY_TESTS = ['tests/integration/profiles-row-actions.test.ts'];

// DOM 이 필요한 .ts 테스트. 나머지 .ts 는 node 환경에서 돌린다 —
// 529개 중 DOM 을 쓰는 것은 .tsx 컴포넌트 테스트와 아래 목록뿐인데, 예전에는 전역
// environment:'jsdom' 이라 400여 파일이 쓰지도 않는 jsdom 을 매번 띄웠다(2026-08-19 측정:
// 같은 57파일이 12.8초 → 6.5초, environment 비용 36.5초 → 3밀리초).
// node 프로젝트에서 DOM 부재로 실패하는 테스트가 나오면 여기에 추가할 것.
const DOM_TS_TESTS = [
  'tests/unit/mail-template/table-attrs-helpers.test.ts',
  'tests/integration/contacts-export-route.test.ts',
  // TipTap 은 document 가 있어야 스키마를 만든다
  'tests/unit/rich-text-editor/extensions.test.ts',
  'tests/unit/rich-text-editor/file-attachment-node.test.ts',
];

const isRealDb = process.env['RUN_REALDB'] === '1';
const isFlakyIsolated = process.env['RUN_FLAKY_ISOLATED'] === '1';

// RUN_REALDB=1(pnpm test:integration) 이면 실 DB 왕복 테스트만, 아니면 일반 테스트(realdb 제외)
// RUN_FLAKY_ISOLATED=1 이면 "전체 스위트에서만 간섭으로 깨지는" 격리 대상 파일만 단독 실행.
// pnpm test 가 [본 스위트(격리 대상 제외) → 격리 대상 단독] 2단으로 돌려 커버리지는 유지하면서
// flaky 로 CI 가 상시 빨간불이 되는 것을 막는다. 근본 원인(전체 실행 시 모킹 간섭)을 고치면
// ISOLATED_FLAKY_TESTS 에서 제거할 것.
const ALL_INCLUDE = ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'workers/**/*.test.{ts,tsx}'];

const baseExclude = isRealDb
  ? [...configDefaults.exclude]
  : [
      ...configDefaults.exclude,
      '**/*.realdb.test.ts',
      ...(isFlakyIsolated ? [] : ISOLATED_FLAKY_TESTS),
    ];

/** 확장자를 한쪽으로 좁힌 include 패턴. 실행 모드별 대상은 그대로 유지한다. */
function includeFor(ext: 'ts' | 'tsx'): string[] {
  if (isRealDb) return ext === 'ts' ? ['tests/integration/**/*.realdb.test.ts'] : [];
  if (isFlakyIsolated) return ext === 'ts' ? ISOLATED_FLAKY_TESTS : [];
  return ALL_INCLUDE.map((p) => p.replace('{ts,tsx}', ext));
}

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
    coverage: {
      provider: 'v8',
      include: ['src/lib/spss/**', 'src/lib/analytics/spss-*'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          // setup.ts 는 DOM 전용이 아니다 — DATABASE_URL·PII 키 등 node 테스트에 필수인
          // 환경변수를 세팅하므로 양쪽 프로젝트가 모두 로드해야 한다.
          setupFiles: ['./tests/setup.ts'],
          include: includeFor('ts'),
          exclude: [...baseExclude, ...DOM_TS_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          // jest-dom matcher 는 DOM 환경에서만 의미가 있어 별도 파일로 분리했다.
          setupFiles: ['./tests/setup.ts', './tests/setup.dom.ts'],
          include: [...includeFor('tsx'), ...(isRealDb || isFlakyIsolated ? [] : DOM_TS_TESTS)],
          exclude: baseExclude,
        },
      },
    ],
  },
});
