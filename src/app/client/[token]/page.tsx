import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { Lock } from 'lucide-react';

import { guestConsoleEntryHref } from '@/features/guest-console/guest-vocabulary';
import { clientLinkPath } from '@/lib/survey-url';
import { resolveClientLinkEntry } from '@/server/access-link';

import { ClientLinkPasswordForm } from './password-form';

/**
 * 클라이언트 링크의 입구 — 비밀번호 화면과 닫힘 화면 (ADR-0029).
 *
 * **인증 가드가 없는 것이 이 페이지의 정의다.** 여기가 세션을 만드는 자리라 가드를 붙이면
 * 클라이언트가 들어올 방법이 사라진다. `tests/repo/rsc-page-guards.test.ts` 의 공개 허용
 * 목록에 사유와 함께 등재돼 있다.
 *
 * **조사 이름이 이 화면에 없다** — 외주 실사 링크의 입구와 일부러 다르다. 저쪽은 여러 조사를
 * 동시에 뛰는 사람이 어느 링크인지 알아야 해서 이름을 보이지만, 이쪽은 토큰만 가진 사람에게
 * 무슨 조사인지 알려 줄 이유가 없다. 그리지 않는 것이 아니라 **받지 않는다**: 판정 코어가
 * 돌려주는 모양에 이름이 없어 RSC payload 에도 실리지 않는다. 이름은 비밀번호를 넣은 뒤의
 * 화면 머리에서 본다.
 *
 * 화면은 둘로만 갈린다.
 *  - **닫힘**(링크 종료·설문 종료·설문 삭제·배치 대기) — 말해 준다. 링크를 이미 가진 사람에게만
 *    보이는 정보다. **설문 중단은 닫힘이 아니다** — 클라이언트는 응답이 멈춘 뒤에 결과를 본다.
 *  - **그 밖 전부** — 비밀번호 화면. 없는 토큰도, 외주 실사 링크의 토큰도 여기로 온다.
 *
 * 이미 접속한 세션은 **허용된 첫 화면**으로 보낸다(없으면 설문 미리보기).
 */
interface PageProps {
  params: Promise<{ token: string }>;
}

export const metadata = { title: '현황 열람' };

export default async function ClientLinkEntryPage({ params }: PageProps) {
  const { token } = await params;
  const entry = await resolveClientLinkEntry(token, await headers());

  if (entry.kind === 'authenticated') {
    redirect(guestConsoleEntryHref(clientLinkPath(token), entry.tabs));
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

        {entry.kind === 'closed' ? (
          <ClosedNotice />
        ) : (
          <>
            <h1 className="mt-5 text-xl font-semibold text-[#1C1C1E]">조사 현황 열람</h1>
            <p className="mt-1.5 text-[13px] text-[#6B7280]">
              전달받은 비밀번호를 입력해 주세요.
            </p>
            {/* 회원가입·이메일 칸이 없다 — 고객사에게 계정을 만들지 않는 것이 이 모델의 전부다. */}
            <ClientLinkPasswordForm token={token} />
            <p className="mt-5 flex items-start gap-2 rounded-lg bg-[#F4F5F8] p-3 text-[12px] leading-[1.6] text-[#6B7280]">
              <Lock className="mt-[2px] h-3.5 w-3.5 shrink-0" />
              <span>이 링크는 조사 한 건의 현황만 보여 줍니다. 열람 전용이며 응답이 남지 않습니다.</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 닫힘 안내 — 사유를 갈라 말하지 않는다.
 *
 * 클라이언트가 할 수 있는 일이 「담당 연구원에게 묻는다」 하나라 사유를 나눠도 쓸 데가 없고,
 * 나누면 배치 대기·삭제처럼 내부 상태가 그대로 외부로 나간다. 외주 입구와 문구가 다른 것은
 * 받는 사람이 달라서다 — 실사·중단을 말하지 않는다.
 */
function ClosedNotice() {
  return (
    <>
      <p className="mt-5 text-[15px] font-medium text-[#1C1C1E]">열람 기간이 끝났습니다</p>
      <p className="mt-2.5 text-[13px] leading-[1.7] text-[#6B7280]">
        이 링크로는 더 이상 현황을 볼 수 없습니다. 자료가 필요하시면 담당 연구원에게 문의해
        주세요.
      </p>
    </>
  );
}
