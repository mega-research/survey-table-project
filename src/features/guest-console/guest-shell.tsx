import Link from 'next/link';

import { ClipboardList } from 'lucide-react';

interface Props {
  /**
   * 로고가 가는 곳 — **null 이면 로고는 링크가 아니다.**
   *
   * 계정 입구는 부여 설문 목록(`/guest`)이 홈이다. 클라이언트 링크 입구에는 홈이 없다 — 링크는
   * 설문 하나만 열고, 「여러 설문을 모아 보는 화면」은 일부러 두지 않았다(ADR-0029).
   */
  homeHref: string | null;
  /**
   * 헤더 오른쪽 자리 — 입구마다 다른 것이 온다.
   *
   * 계정 입구는 프로필·로그아웃 메뉴이고, 링크 입구는 쿠키 하나를 지우는 「나가기」다. 셸이 그
   * 둘을 알면 이 묶음이 계정 모델과 링크 모델을 함께 import 하게 되고, 링크로 들어온
   * 클라이언트에게 프로필·로그인 화면으로 가는 버튼이 생긴다. 운영 콘솔 헤더의 `trailing` 과
   * 같은 방식이다.
   */
  trailing: React.ReactNode;
  children: React.ReactNode;
}

/**
 * 클라이언트 콘솔 공통 셸 — 헤더바 하나 (.pen FLOW 5-2·5-3, 역할 모델 v2 티켓 22).
 *
 * 내부 콘솔의 사이드바에 대응하는 자리지만 **메뉴가 없다**. 클라이언트가 갈 수 있는 곳은
 * 열어 준 설문뿐이라 좌측 내비게이션은 언제나 홈과 같은 내용이 된다. .pen 5-2·5-3 이 헤더바
 * 하나만 그리는 이유이며, 「부여되지 않은 설문·내부 메뉴는 존재 자체가 보이지 않는다」는
 * 노트가 화면 구조에 그대로 남은 결과다.
 *
 * 두 입구(게스트 계정 · 클라이언트 링크)가 함께 쓴다 — 그래서 누가 들어왔는지를 모른다.
 */
export function GuestShell({ homeHref, trailing, children }: Props) {
  const logo = (
    <>
      <span
        aria-hidden
        className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[#E0E7FF]"
      >
        <ClipboardList className="h-[15px] w-[15px] text-[#2743AE]" />
      </span>
      <span className="text-[14px] font-semibold text-[#1C1C1E]">메가허브</span>
    </>
  );
  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="flex h-[56px] items-center justify-between border-b border-[#E5E5EA] bg-white px-6">
        {/* 로고는 홈으로 — 열람 화면에서 목록으로 돌아가는 두 번째 길이다(첫째는 뒤로 버튼). */}
        {homeHref ? (
          <Link href={homeHref} className="flex items-center gap-2">
            {logo}
          </Link>
        ) : (
          <div className="flex items-center gap-2">{logo}</div>
        )}
        {trailing}
      </header>
      {children}
    </div>
  );
}
