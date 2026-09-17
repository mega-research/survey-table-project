import Link from 'next/link';

import { ClipboardList } from 'lucide-react';

import { AccountMenu } from '@/components/auth/account-menu';
import type { AuthUser } from '@/shared/contracts/auth';

interface Props {
  user: AuthUser;
  /** 소속 기관 메모 (users.organization). 헤더 표시에만 쓴다. */
  organization: string | null;
  children: React.ReactNode;
}

/**
 * 게스트 콘솔 공통 셸 — 헤더바 하나 (.pen FLOW 5-2·5-3, 역할 모델 v2 티켓 22).
 *
 * 내부 콘솔의 사이드바에 대응하는 자리지만 **메뉴가 없다**. 게스트가 갈 수 있는 곳은
 * 부여된 설문뿐이고 그 목록이 곧 홈이라, 좌측 내비게이션은 언제나 홈과 같은 내용이 된다.
 * .pen 5-2·5-3 이 헤더바 하나만 그리는 이유이며, 「부여되지 않은 설문·내부 메뉴는 존재
 * 자체가 보이지 않는다」는 노트가 화면 구조에 그대로 남은 결과다.
 *
 * 서버 컴포넌트다 — 사용자 메뉴만 클라이언트 조각(AccountMenu)이다.
 */
export function GuestShell({ user, organization, children }: Props) {
  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="flex h-[56px] items-center justify-between border-b border-[#E5E5EA] bg-white px-6">
        {/* 로고는 홈으로 — 열람 화면에서 목록으로 돌아가는 두 번째 길이다(첫째는 뒤로 버튼). */}
        <Link href="/guest" className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[#E0E7FF]"
          >
            <ClipboardList className="h-[15px] w-[15px] text-[#2743AE]" />
          </span>
          <span className="text-[14px] font-semibold text-[#1C1C1E]">메가허브</span>
        </Link>
        <AccountMenu
          name={user.name}
          affiliation={organization}
          badge="게스트"
          image={user.image ?? null}
        />
      </header>
      {children}
    </div>
  );
}
