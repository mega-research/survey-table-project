import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { Lock } from 'lucide-react';

import { fieldworkLinkOperationsPaths } from '@/features/operations/operations-paths';
import { resolveAccessLinkEntry } from '@/server/access-link';

import { FieldworkLinkPasswordForm } from './password-form';

/**
 * 외주 실사 링크의 입구 — 비밀번호 화면과 닫힘 화면 (ADR-0026, .pen FLOW 10-3).
 *
 * **인증 가드가 없는 것이 이 페이지의 정의다.** 여기가 세션을 만드는 자리라 가드를 붙이면
 * 외주가 들어올 방법이 사라진다. `tests/repo/rsc-page-guards.test.ts` 의 공개 허용 목록에
 * 사유와 함께 등재돼 있다.
 *
 * 화면은 둘로만 갈린다.
 *  - **닫힘**(설문 중단·링크 종료·설문 삭제·배치 대기) — 말해 준다. 링크를 이미 가진
 *    사람에게만 보이는 정보라 새는 것이 없고, 감추면 외주가 오타로 오해해 연구원에게
 *    문의한다(스토리 21).
 *  - **그 밖 전부** — 비밀번호 화면. 없는 토큰도 여기로 온다: 「그런 링크는 없다」를 말하면
 *    주소 스캔이 링크의 존재를 확인하는 창구가 된다.
 *
 * 이미 접속한 세션은 조사 대상 목록으로 보낸다. 그 화면은 티켓 06 이 세운다.
 */
interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function FieldworkLinkEntryPage({ params }: PageProps) {
  const { token } = await params;
  const entry = await resolveAccessLinkEntry(token, await headers());

  if (entry.kind === 'authenticated') {
    redirect(fieldworkLinkOperationsPaths(token).contacts);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F5F8] p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-gray-100 bg-white px-[34px] pt-9 pb-[30px] shadow-[0_10px_25px_rgba(13,27,76,0.08)]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#0D1B4C]">
            <Lock className="h-[17px] w-[17px] text-white" />
          </span>
          <span className="text-[15px] font-semibold text-[#0D1B4C]">메가리서치</span>
        </div>

        {/* 조사 이름 — 여러 조사를 병행할 때 어느 링크인지 알아야 한다(스토리 17). */}
        {entry.surveyTitle !== null && (
          <h1 className="mt-5 text-xl font-semibold text-[#1C1C1E]">{entry.surveyTitle}</h1>
        )}

        {entry.kind === 'closed' ? (
          <ClosedNotice />
        ) : (
          <>
            <p className="mt-1.5 text-[13px] text-[#6B7280]">
              외주 실사 접속 · 이 설문 전용 링크
            </p>
            {/* 회원가입·이메일 칸이 없다 — 단기 인력이 당일 투입되는 것이 이 모델의 전부다. */}
            <FieldworkLinkPasswordForm token={token} />
            <p className="mt-5 flex items-start gap-2 rounded-lg bg-[#F4F5F8] p-3 text-[12px] leading-[1.6] text-[#6B7280]">
              <Lock className="mt-[2px] h-3.5 w-3.5 shrink-0" />
              <span>
                이 링크는 이 설문의 조사 대상에만 닿습니다. 설문이 중단되거나 종료되면 닫힙니다.
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 닫힘 안내 — 다섯 사유를 갈라 말하지 않는다.
 *
 * 외주가 할 수 있는 일이 「연구원에게 묻는다」 하나라 사유를 나눠도 쓸 데가 없고, 나누면
 * 배치 대기·삭제처럼 내부 상태가 그대로 외부로 나간다. 「다시 열릴 수 있다」를 적는 것은
 * 중단도 설문 종료(ADR-0030)도 되돌릴 수 있기 때문이다 — 어느 쪽이든 링크 행을 건드리지
 * 않아 주소와 비밀번호는 그대로 쓴다.
 */
function ClosedNotice() {
  return (
    <>
      <p className="mt-1.5 text-[15px] font-medium text-[#1C1C1E]">접속이 닫혔습니다</p>
      <p className="mt-2.5 text-[13px] leading-[1.7] text-[#6B7280]">
        이 설문의 실사가 중단·종료되었거나 링크가 종료되었습니다. 다시 열리면 지금 받은 주소와
        비밀번호를 그대로 쓸 수 있으니, 담당 연구원에게 문의해 주세요.
      </p>
    </>
  );
}
