'use client';

import { useState } from 'react';

import { AlertCircle, Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clientLinkPath } from '@/lib/survey-url';
import { client } from '@/shared/lib/rpc';

/**
 * 클라이언트 링크의 비밀번호 한 칸 (ADR-0029).
 *
 * 외주 실사 링크의 폼(`app/fw/[token]/password-form`)과 같은 규칙을 따른다.
 *  - 실패 문구가 **하나뿐이다** — 없는 토큰과 틀린 비밀번호를 가르면 이 화면이 링크 존재 확인
 *    창구가 된다. 서버도 같은 `denied` 를 돌려주므로 화면이 나눌 재료 자체가 없다.
 *  - 닫힘은 **페이지를 다시 열어** 서버가 닫힘 화면을 그리게 한다. 연구원이 방금 설문을
 *    종료했을 수 있고, 여기서 닫힘 문구를 복제하면 두 벌이 된다.
 *  - 성공 뒤 이동은 전체 리로드다. 세션 쿠키가 방금 생겼고 그 쿠키로 RSC 를 다시 받아야 한다.
 *
 * 성공하면 **입구 주소로** 간다 — 어느 화면이 허용돼 있는지는 서버만 안다(탭 화이트리스트).
 * 입구가 접속된 세션을 보고 허용된 첫 화면으로 보낸다.
 *
 * 폼을 한 벌로 합치지 않은 것은 부르는 표면이 달라서다(`authenticateClient`). 표면이 갈린
 * 이유는 로그이고(RPC 이름이 곧 입구의 종류다), 폼을 합치면 그 선택이 prop 하나로 내려와
 * 「외주 폼이 클라이언트 표면을 부르는」 조합이 타입상 만들어진다.
 */
const AUTH_FAILED = '비밀번호가 올바르지 않습니다.';
const RATE_LIMITED = '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';

interface Props {
  token: string;
}

export function ClientLinkPasswordForm({ token }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);

  async function handleSubmit(formData: FormData) {
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.workspace.accessLinkSession.authenticateClient({
        token,
        password: String(formData.get('password') ?? ''),
      });
      if (result.ok) {
        window.location.assign(clientLinkPath(token));
        return;
      }
      if (result.reason === 'closed') {
        window.location.reload();
        return;
      }
      setError(AUTH_FAILED);
    } catch (err) {
      // 한도 초과만 갈라 말한다 — 「내가 오타를 냈다」와 「잠시 막혔다」를 구별해야
      // 클라이언트가 연구원에게 헛되이 문의하지 않는다.
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
        <Label htmlFor="client-password" className="text-[13px] font-medium text-[#374151]">
          접속 비밀번호
        </Label>
        <div className="relative">
          <Input
            id="client-password"
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
