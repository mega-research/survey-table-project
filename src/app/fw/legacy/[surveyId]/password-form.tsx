'use client';

import { useState } from 'react';

import { AlertCircle, Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { legacyBridgeRoutePath } from '@/lib/auth/legacy-guest-link';
import { client } from '@/shared/lib/rpc';

/**
 * 옛 주소 다리의 비밀번호 한 칸 (fieldwork-multi-company 티켓 10).
 *
 * `/fw/[token]` 의 비밀번호 칸과 모양·문구가 같고, 다른 것은 둘이다.
 *  - 토큰 대신 **설문 id** 를 보낸다 — 옛 게스트 주소가 담은 것이 그것뿐이다.
 *  - 성공하면 링크 콘솔이 아니라 **다리 라우트로 돌아간다.** 응답에 토큰이 없어 화면은 링크 주소를
 *    모르고, 라우트가 방금 심은 쿠키 하나로 그 링크를 고른다(전체 리로드 — 쿠키로 다시 판정해야 한다).
 *
 * 실패 문구가 하나뿐인 것이 계약이다. 서버는 틀린 비밀번호와 「두 링크에 다 맞음」에 같은 `denied`
 * 를 주므로 화면이 나눌 재료가 없다. 닫힘은 페이지를 새로 고쳐 서버가 닫힘 안내를 그리게 한다.
 */
const AUTH_FAILED = '비밀번호가 올바르지 않습니다.';
const RATE_LIMITED = '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';

interface Props {
  surveyId: string;
}

export function LegacyBridgePasswordForm({ surveyId }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);

  async function handleSubmit(formData: FormData) {
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.workspace.accessLinkSession.authenticateLegacyBridge({
        surveyId,
        password: String(formData.get('password') ?? ''),
      });
      if (result.ok) {
        window.location.assign(legacyBridgeRoutePath(surveyId));
        return;
      }
      if (result.reason === 'closed') {
        window.location.reload();
        return;
      }
      setError(AUTH_FAILED);
    } catch (err) {
      setError(isTooManyRequests(err) ? RATE_LIMITED : AUTH_FAILED);
    }
    setIsLoading(false);
  }

  return (
    <form action={handleSubmit} className="mt-5 flex flex-col gap-[18px]">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-[7px]">
        <Label htmlFor="fw-legacy-password" className="text-[13px] font-medium text-[#374151]">
          접속 비밀번호
        </Label>
        <div className="relative">
          <Input
            id="fw-legacy-password"
            name="password"
            type={revealed ? 'text' : 'password'}
            placeholder="••••••••"
            autoComplete="off"
            required
            className="h-11 rounded-[10px] pr-11"
            disabled={isLoading}
          />
          <button
            type="button"
            onClick={() => setRevealed((prev) => !prev)}
            aria-label={revealed ? '비밀번호 가리기' : '비밀번호 표시'}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Button
        type="submit"
        className="h-12 w-full rounded-[10px] bg-[#2E4FCE] text-[15px] font-medium text-white hover:bg-[#2743AE]"
        disabled={isLoading}
      >
        {isLoading ? '확인 중...' : '들어가기'}
      </Button>
    </form>
  );
}

/** oRPC 거부 코드는 에러 객체의 `code` 로 온다 — 문구 매칭은 하지 않는다(문구가 바뀐다). */
function isTooManyRequests(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'TOO_MANY_REQUESTS'
  );
}
