import { AccountMenu } from '@/components/auth/account-menu';
import type { AuthUser } from '@/shared/contracts/auth';

interface Props {
  user: AuthUser;
  /** 소속 기관 메모 (users.organization). 헤더 표시에만 쓴다. */
  organization: string | null;
}

/**
 * 게스트 홈 (.pen FLOW 5-2) — **이 티켓에서는 스텁이다**.
 *
 * 담당 연구원이 부여한 설문 카드를 나열하는 자리인데, 부여 관계(survey_participants 게스트
 * 지분)가 티켓 21 에서 생기므로 지금은 빈 상태만 보여준다. 스텁이라도 있어야 하는 이유는
 * 티켓 03 이 게스트 계정 발급을 열었기 때문이다 — 목적지가 없으면 로그인은 되는데 갈 곳이
 * 없어 내부 화면에서 거부만 당한다.
 *
 * 서버 컴포넌트다. 데이터가 없으므로 클라이언트 상태도 없다 — 티켓 22 가 목록을 채울 때
 * 필요한 만큼만 클라이언트 조각을 나누면 된다.
 */
export function GuestHomeView({ user, organization }: Props) {
  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="flex h-[56px] items-center justify-between border-b border-[#E5E5EA] bg-white px-6">
        <span className="text-[14px] font-semibold text-[#1C1C1E]">메가허브</span>
        <AccountMenu name={user.name} affiliation={organization} badge="게스트" />
      </header>

      <main className="mx-auto max-w-[900px] px-4 py-10">
        <div className="space-y-1">
          <h1 className="text-[22px] font-semibold text-[#1C1C1E]">열람 가능한 조사</h1>
          <p className="text-[13px] text-[#6E6E73]">
            담당 연구원이 부여한 설문의 미리보기와 현황을 볼 수 있습니다.
          </p>
        </div>

        <div className="mt-6 rounded-[14px] border border-dashed border-[#D1D5DB] bg-white py-16 text-center">
          <p className="text-[13.5px] font-semibold text-[#3A3A3C]">부여된 설문이 없습니다.</p>
          <p className="mt-1 text-[12.5px] text-[#9CA3AF]">
            담당 연구원이 설문을 부여하면 여기에 표시됩니다.
          </p>
        </div>
      </main>
    </div>
  );
}
