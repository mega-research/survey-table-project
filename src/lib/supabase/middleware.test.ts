import { NextRequest } from 'next/server';

import { expect, it, vi } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
  }),
}));

it('로그인된 관리자의 로그인 페이지 redirect 우회는 목록으로 떨어진다', async () => {
  const { updateSession } = await import('@/lib/supabase/middleware');
  const ok = await updateSession(
    new NextRequest(
      'https://survey.megaresearch.co.kr/admin/login?redirect=%2Fadmin%2Fsurveys%2Fs1%2Fpreview',
    ),
  );
  expect(ok.headers.get('location')).toBe(
    'https://survey.megaresearch.co.kr/admin/surveys/s1/preview',
  );
  for (const q of [
    '%2F%09%2Fevil.example%2Fsignin',
    '%2F%0A%2Fevil.example',
    '%2F%5C%2Fevil.example',
    '%2F%2Fevil.example',
  ]) {
    const res = await updateSession(
      new NextRequest(`https://survey.megaresearch.co.kr/admin/login?redirect=${q}`),
    );
    expect(res.headers.get('location')).toBe('https://survey.megaresearch.co.kr/admin/surveys');
  }
});
