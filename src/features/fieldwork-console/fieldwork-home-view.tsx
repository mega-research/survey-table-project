import { AccountMenu } from '@/components/auth/account-menu';
import type { AuthUser } from '@/shared/contracts/auth';

interface Props {
  user: AuthUser;
  /** 소속 업체명. 업체 엔티티(fieldwork_orgs)는 티켓 24 소관이라 지금은 항상 null 이다. */
  organization: string | null;
}

/**
 * 실사 홈 (.pen FLOW 10-1) — **이 티켓에서는 스텁이다**.
 *
 * 초대된 설문의 진척과 조사 대상 진입점을 나열하는 자리인데, 실사 업체·초대 관계가
 * 티켓 24·25 에서 생기므로 지금은 빈 상태만 보여준다. 게스트 홈과 같은 이유로 스텁이라도
 * 있어야 한다 — 유형 게이트가 내부 표면을 막는 이상 갈 곳이 필요하다.
 *
 * .pen 의 「내 초대 설문 / 업체 전체」 세그먼트는 실사 팀장 전용 시야라 티켓 25 가 붙인다.
 */
export function FieldworkHomeView({ user, organization }: Props) {
  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="flex h-[56px] items-center justify-between border-b border-[#E5E5EA] bg-white px-6">
        <span className="text-[14px] font-semibold text-[#1C1C1E]">메가허브 실사</span>
        <AccountMenu name={user.name} affiliation={organization} badge="실사" />
      </header>

      <main className="mx-auto max-w-[900px] px-4 py-10">
        <div className="space-y-1">
          <h1 className="text-[22px] font-semibold text-[#1C1C1E]">실사 설문</h1>
          <p className="text-[13px] text-[#6E6E73]">
            초대된 설문에서 조사 대상을 확인하고 대리 응답을 진행합니다.
          </p>
        </div>

        <div className="mt-6 rounded-[14px] border border-dashed border-[#D1D5DB] bg-white py-16 text-center">
          <p className="text-[13.5px] font-semibold text-[#3A3A3C]">초대된 설문이 없습니다.</p>
          <p className="mt-1 text-[12.5px] text-[#9CA3AF]">
            담당 연구원이 설문에 초대하면 여기에 표시됩니다.
          </p>
        </div>
      </main>
    </div>
  );
}
