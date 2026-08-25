import react from '@vitejs/plugin-react';
import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';


// DOM 이 필요한 .ts 테스트. 나머지 .ts 는 node 환경에서 돌린다 —
// 전 스위트에서 DOM 을 쓰는 것은 .tsx 컴포넌트 테스트와 아래 목록뿐인데, 예전에는 전역
// environment:'jsdom' 이라 400여 파일이 쓰지도 않는 jsdom 을 매번 띄웠다(2026-08-19 측정:
// 같은 57파일이 12.8초 → 6.5초, environment 비용 36.5초 → 3밀리초).
// node 프로젝트에서 DOM 부재로 실패하는 테스트가 나오면 여기에 추가할 것.
const DOM_TS_TESTS = [
  'src/components/ui/rich-text-editor/table-attrs-helpers.test.ts',
  'tests/integration/contacts-export-route.test.ts',
  // TipTap 은 document 가 있어야 스키마를 만든다
  'src/components/ui/rich-text-editor/extensions.test.ts',
  'src/components/ui/rich-text-editor/file-attachment-node.test.ts',
];

const isRealDb = process.env['RUN_REALDB'] === '1';

// RUN_REALDB=1(pnpm test:integration) 이면 실 DB 왕복 테스트만, 아니면 일반 테스트(realdb 제외).
//
// 2026-08-19 까지는 profiles-row-actions 를 격리 실행하는 2단 구조가 있었다. "전체 스위트에서만
// 모킹 간섭으로 깨진다"는 진단이었으나 사실이 아니었다 — 그 파일이 @/db/schema 에 vi.mock 을
// 두 번 걸고 있었고 어느 팩토리가 이기는지 보장되지 않는 것이 원인이었다. 중복을 제거하니
// 전체 스위트에 포함해도 통과해 2단 구조를 걷어냈다.
const ALL_INCLUDE = ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'workers/**/*.test.{ts,tsx}'];

const baseExclude = isRealDb
  ? [...configDefaults.exclude]
  : [...configDefaults.exclude, '**/*.realdb.test.ts'];

/** 확장자를 한쪽으로 좁힌 include 패턴. 실행 모드별 대상은 그대로 유지한다. */
function includeFor(ext: 'ts' | 'tsx'): string[] {
  if (isRealDb) return ext === 'ts' ? ['tests/integration/**/*.realdb.test.ts'] : [];
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
      include: [
        'src/lib/spss/**',
        'src/lib/analytics/spss-*',
        // SPSS 변수명 발번 규칙 — lib 흡수로 빌더 feature 로 이동했다.
        'src/features/survey-builder/lib/variable-generator.ts',
      ],
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
          include: [...includeFor('tsx'), ...(isRealDb ? [] : DOM_TS_TESTS)],
          exclude: baseExclude,
        },
      },
    ],
  },
});
