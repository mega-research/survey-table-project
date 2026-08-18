'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  getGuestSurveyIds,
  guestPostLoginRedirect,
  isForeignSurveyConsolePath,
  sanitizeInternalPath,
} from '@/lib/auth/guest-grants';
import { createClient } from '@/lib/supabase/server';

const DEFAULT_REDIRECT = '/admin/surveys';

/**
 * 로그인 후 이동할 경로를 안전하게 결정.
 * open redirect 방지를 위해 같은 출처의 내부 절대경로만 허용하고,
 * 루트("/")·로그인 페이지는 기본 경로로 대체한다.
 */
function resolveRedirect(raw: FormDataEntryValue | null): string {
  const sanitized = sanitizeInternalPath(typeof raw === 'string' ? raw : null);
  if (!sanitized) return DEFAULT_REDIRECT;
  const path = sanitized.split(/[?#]/)[0];
  if (path === '/' || path === '/admin/login') return DEFAULT_REDIRECT;
  return sanitized;
}

export async function login(formData: FormData) {
  const supabase = await createClient();

  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  };

  const { data: signIn, error } = await supabase.auth.signInWithPassword(data);

  if (error) {
    return { error: error.message };
  }

  const target = resolveRedirect(formData.get('redirect'));
  const grantedSurveyIds = signIn.user ? getGuestSurveyIds(signIn.user.id) : [];

  if (grantedSurveyIds.length > 0) {
    // 다른 설문 콘솔을 향한 게스트 로그인 — 자기 설문으로 몰래 보내면 착각을
    // 유발하므로 세션을 만들지 않고 로그인창에 남겨 담당 계정을 안내한다.
    const targetPath = target.split(/[?#]/)[0] ?? target;
    if (isForeignSurveyConsolePath(targetPath, grantedSurveyIds)) {
      await supabase.auth.signOut({ scope: 'local' });
      return {
        error: `${data.email} 은 해당 설문지에 권한이 없습니다. 해당 설문 담당 계정으로 로그인해 주세요.`,
      };
    }
    revalidatePath('/', 'layout');
    // 게스트는 기본 목적지(/admin/surveys)·무권한 경로가 강제 로그아웃 루프가
    // 되므로 자기 grant 설문으로 정착시킨다.
    redirect(guestPostLoginRedirect(target, grantedSurveyIds));
  }

  revalidatePath('/', 'layout');
  redirect(target);
}

export async function logout() {
  const supabase = await createClient();
  // scope 'local': 현재 브라우저 세션만 종료 — 기본 global 은 전 기기 refresh
  // token 을 폐기해 공유 게스트 계정의 다른 실사 인력까지 튕긴다.
  await supabase.auth.signOut({ scope: 'local' });
  revalidatePath('/', 'layout');
  redirect('/admin/login');
}

