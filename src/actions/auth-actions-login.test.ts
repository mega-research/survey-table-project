import { beforeEach, describe, expect, it, vi } from 'vitest';

import { login } from '@/actions/auth-actions';

const { signInWithPassword, signOut, redirect } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  redirect: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signInWithPassword, signOut } }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('login 서버 액션 (게스트 설문 권한)', () => {
  const email = 'guest1@megaresearch.co.kr';

  it('redirect 대상이 자기 담당이 아닌 설문 콘솔이면 세션을 끝내고 에러로 로그인창에 남긴다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'guest-1' } }, error: null });

    const result = await login(
      form({ email, password: 'pw', redirect: '/admin/surveys/other/operations/overview' }),
    );

    expect(result?.error).toBe(
      `${email} 은 해당 설문지에 권한이 없습니다. 해당 설문 담당 계정으로 로그인해 주세요.`,
    );
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirect 대상이 자기 grant 설문이면 그 경로로 복귀한다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'guest-1' } }, error: null });

    await login(
      form({ email, password: 'pw', redirect: '/admin/surveys/survey-a/operations/contacts' }),
    );

    expect(signOut).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/admin/surveys/survey-a/operations/contacts');
  });

  it('redirect 없는 게스트 로그인은 자기 grant 설문 overview 로', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:survey-a');
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'guest-1' } }, error: null });

    await login(form({ email, password: 'pw' }));

    expect(redirect).toHaveBeenCalledWith('/admin/surveys/survey-a/operations/overview');
  });

  it('grant 없는 관리자는 검사 없이 목적지로 간다', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null });

    await login(
      form({
        email: 'admin@megaresearch.co.kr',
        password: 'pw',
        redirect: '/admin/surveys/other/operations/overview',
      }),
    );

    expect(signOut).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/admin/surveys/other/operations/overview');
  });

  it('인증 실패는 supabase 에러 메시지를 그대로 반환한다', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });

    const result = await login(form({ email, password: 'bad' }));

    expect(result?.error).toBe('Invalid login credentials');
    expect(redirect).not.toHaveBeenCalled();
  });
});
