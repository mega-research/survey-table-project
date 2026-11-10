import { redirect } from 'next/navigation';

import { Lock } from 'lucide-react';

import { legacyConsoleStaffPath } from '@/lib/auth/legacy-guest-link';
import { isLegacyBridgeOpen } from '@/server/legacy-bridge';

import { LegacyBridgePasswordForm } from './password-form';

/**
 * 옛 주소 다리의 비밀번호 화면 (fieldwork-multi-company 티켓 10).
 *
 * 옛 게스트 주소(`/admin/surveys/<id>/operations`)로 온 업체를, 그 설문에 외주 링크가 여럿이고 이
 * 브라우저에 고를 세션이 없을 때 여기서 받는다(`app/api/legacy-guest-link`). 비밀번호를 넣으면 그
 * 비밀번호가 맞는 링크 **하나**로 들어간다.
 *
 * **인증 가드가 없는 것이 이 페이지의 정의다** — `/fw/[token]` 입구와 같다(세션을 만드는 자리).
 * `tests/repo/rsc-page-guards.test.ts` 의 공개 허용 목록에 사유와 함께 등재돼 있다.
 *
 * `/fw/[token]` 입구와 다른 것은 **조사 이름을 그리지 않는 것**이다. 저쪽은 토큰을 쥔 사람에게만
 * 이름을 보이지만 이 화면은 설문 id 만 아는 사람 누구나 연다. 업체 목록·이름표·링크 수도 없다 —
 * 다리 경로에서는 비밀번호만이 업체 사이 칸막이라, 화면이 업체를 드러내면 짐작할 거리가 생긴다.
 *
 * **닫힘도 그리지 않는다** — 닫힘(중단·종료·삭제·배치 대기)은 맞는 비밀번호에만 말해 주는 정보라, 첫 화면은
 * 언제나 비밀번호 칸이고 닫힘 안내는 비밀번호 칸이 맞는 비밀번호의 `closed` 를 받은 뒤 그 자리에서 그린다.
 *
 * 허용 목록 밖의 설문이면 다리가 꺼진 것과 같다 — 다리 라우트가 냈을 답(내부 콘솔 주소)으로 보낸다.
 */
interface PageProps {
  params: Promise<{ surveyId: string }>;
}

export default async function LegacyBridgePasswordPage({ params }: PageProps) {
  const { surveyId } = await params;
  if (!isLegacyBridgeOpen(surveyId)) redirect(legacyConsoleStaffPath(surveyId, []));

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F5F8] p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-gray-100 bg-white px-[34px] pt-9 pb-[30px] shadow-[0_10px_25px_rgba(13,27,76,0.08)]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#0D1B4C]">
            <Lock className="h-[17px] w-[17px] text-white" />
          </span>
          <span className="text-[15px] font-semibold text-[#0D1B4C]">메가리서치</span>
        </div>

        <LegacyBridgePasswordForm surveyId={surveyId} />
      </div>
    </div>
  );
}
