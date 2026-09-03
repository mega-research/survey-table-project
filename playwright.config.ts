import { defineConfig, devices } from '@playwright/test';

// e2e 는 realdb 스위트(test:integration)와 같은 로컬 supabase 테스트 DB 를 쓴다.
// dev 서버에는 DATABASE_URL 로 주입해 .env.local(스테이징 클론) 우선 규칙을 이긴다.
// 이 값은 워커에서도 config 가 다시 로드되며 시드 헬퍼가 같은 키로 읽는다.
const E2E_DATABASE_URL =
  process.env['E2E_DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env['E2E_DATABASE_URL'] = E2E_DATABASE_URL;

// 개발자의 상시 dev 서버(:3000, 별도 env)를 재사용하면 시드 DB 와 어긋나므로
// e2e 는 전용 포트에서 자기 서버를 띄운다.
const PORT = Number(process.env['E2E_PORT'] ?? 3100);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    env: {
      ...(process.env as Record<string, string>),
      DATABASE_URL: E2E_DATABASE_URL,
    },
  },
});
