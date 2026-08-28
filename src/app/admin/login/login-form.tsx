'use client';

import { useState } from 'react';

import { AlertCircle, Lock, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth/client';

/**
 * 인증 실패 문구는 항상 하나다 — 계정 미존재·비밀번호 불일치·비활성 계정
 * (pending/rejected/suspended/departed)을 구분하지 않는다(ADR-0018).
 */
const SIGN_IN_FAILED = '이메일 또는 비밀번호가 올바르지 않습니다.';

interface LoginFormProps {
  /** 로그인 후 복귀할 경로. proxy 가 붙인 redirect 쿼리에서 전달된다. */
  redirectTo: string;
}

// 「담당 설문이 아닙니다」 안내는 티켓 21 에서 사라졌다 — 그 문구는 env grant 게스트를 강제
// 로그아웃시키던 동선의 것이고, 계정 모델의 게스트는 로그아웃 대신 자기 홈(/guest)으로 간다.

export function LoginForm({ redirectTo }: LoginFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setIsLoading(true);
    setError(null);

    try {
      const { error: signInError } = await authClient.signIn.email({
        email: formData.get('email') as string,
        password: formData.get('password') as string,
      });
      if (signInError) {
        setError(SIGN_IN_FAILED);
        setIsLoading(false);
        return;
      }
    } catch {
      setError(SIGN_IN_FAILED);
      setIsLoading(false);
      return;
    }

    // 세션 쿠키가 생긴 상태로 이 페이지에 다시 들어가면 서버가 유형별 목적지를 계산해
    // 보낸다(page.tsx). 전체 리로드라 RSC 도 새 세션으로 다시 받는다.
    const search = redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : '';
    window.location.assign(`/admin/login${search}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F5F8] p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-gray-100 bg-white px-[34px] pt-9 pb-[30px] shadow-[0_10px_25px_rgba(13,27,76,0.08)]">
        <form action={handleSubmit} className="flex flex-col gap-[18px]">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#E0E7FF]">
              <Lock className="h-7 w-7 text-[#2E4FCE]" />
            </div>
            <h1 className="text-2xl font-semibold text-[#1C1C1E]">로그인</h1>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-[7px]">
            <Label htmlFor="email" className="text-[13px] font-medium text-[#374151]">
              이메일
            </Label>
            <div className="relative">
              <Mail className="absolute top-1/2 left-[15px] h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="admin@example.com"
                required
                className="h-11 rounded-[10px] pl-10"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-[7px]">
            <Label htmlFor="password" className="text-[13px] font-medium text-[#374151]">
              비밀번호
            </Label>
            <div className="relative">
              <Lock className="absolute top-1/2 left-[15px] h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                className="h-11 rounded-[10px] pl-10"
                disabled={isLoading}
              />
            </div>
          </div>

          <Button
            type="submit"
            className="h-12 w-full rounded-[10px] bg-[#2E4FCE] text-[15px] font-medium text-white hover:bg-[#2743AE]"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                로그인 중...
              </span>
            ) : (
              '로그인'
            )}
          </Button>

          {/* 회원가입·비밀번호 찾기 링크는 없다 — 계정 발급도 재설정도 슈퍼어드민 몫이다. */}
          <p className="text-[13px] font-medium text-[#2E4FCE]">
            비밀번호를 잊으면 관리자에게 재설정을 요청하세요
          </p>
        </form>
      </div>
    </div>
  );
}
