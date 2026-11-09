import { redirect } from 'next/navigation';

import { Lock } from 'lucide-react';

import { legacyConsoleStaffPath } from '@/lib/auth/legacy-guest-link';
import { resolveLegacyBridgeEntry } from '@/server/access-link';

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
 * 허용 목록 밖의 설문이면 다리가 꺼진 것과 같다 — 다리 라우트가 냈을 답(내부 콘솔 주소)으로 보낸다.
 */
interface PageProps {
  params: Promise<{ surveyId: string }>;
}

export default async function LegacyBridgePasswordPage({ params }: PageProps) {
  const { surveyId } = await params;
  const entry = await resolveLegacyBridgeEntry(surveyId);
  if (entry === null) redirect(legacyConsoleStaffPath(surveyId, []));

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F5F8] p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-gray-100 bg-white px-[34px] pt-9 pb-[30px] shadow-[0_10px_25px_rgba(13,27,76,0.08)]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#0D1B4C]">
            <Lock className="h-[17px] w-[17px] text-white" />
          </span>
          <span className="text-[15px] font-semibold text-[#0D1B4C]">메가리서치</span>
        </div>

        {entry.kind === 'closed' ? (
          <>
            <p className="mt-5 text-[15px] font-medium text-[#1C1C1E]">접속이 닫혔습니다</p>
            <p className="mt-2.5 text-[13px] leading-[1.7] text-[#6B7280]">
              이 설문의 실사가 중단·종료되었습니다. 다시 열리면 지금 받은 비밀번호를 그대로 쓸 수
              있으니, 담당 연구원에게 문의해 주세요.
            </p>
          </>
        ) : (
          <>
            <p className="mt-5 text-[15px] font-medium text-[#1C1C1E]">외주 실사 접속</p>
            <p className="mt-1.5 text-[13px] leading-[1.6] text-[#6B7280]">
              전달받은 접속 비밀번호를 입력해 주세요.
            </p>
            <LegacyBridgePasswordForm surveyId={surveyId} />
            <p className="mt-5 flex items-start gap-2 rounded-lg bg-[#F4F5F8] p-3 text-[12px] leading-[1.6] text-[#6B7280]">
              <Lock className="mt-[2px] h-3.5 w-3.5 shrink-0" />
              <span>
                주소가 바뀌었습니다. 들어간 뒤의 주소를 즐겨찾기에 다시 저장해 두면 다음부터 이
                화면을 거치지 않습니다.
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
