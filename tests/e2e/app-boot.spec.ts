import { expect, test } from '@playwright/test';

test('admin 로그인 페이지가 렌더된다', async ({ page }) => {
  const res = await page.goto('/login');
  expect(res?.ok()).toBeTruthy();
  // 로그인 폼의 핵심 요소가 보이는지 (id="email" input)
  await expect(page.locator('#email')).toBeVisible();
});

test('health RPC가 ok를 반환한다', async ({ request }) => {
  const res = await request.post('/api/rpc/health/check', {
    headers: { 'content-type': 'application/json' },
    data: { json: null },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  // RPC 직렬화: { json: { ok: true, now } }
  expect(body?.json?.ok ?? body?.ok).toBe(true);
});
