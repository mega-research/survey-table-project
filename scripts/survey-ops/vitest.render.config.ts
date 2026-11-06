/**
 * `pnpm survey:render` 전용 vitest 설정 — 레포 설정(별칭·React·setup)을 그대로 쓰고 대상만 출력기 하나로 좁힌다.
 * 일반 `pnpm test` 의 include 에는 scripts/ 가 없어 이 파일은 거기서 돌지 않는다.
 */
import { defineConfig, mergeConfig } from 'vitest/config';

import base from '../../vitest.config';

export default mergeConfig(
  { ...base, test: { ...base.test, projects: undefined } },
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts', './tests/setup.dom.ts'],
      include: ['scripts/survey-ops/render.probe.tsx'],
      reporters: ['dot'],
    },
  }),
);
