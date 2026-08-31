import { AccountMenu } from '@/components/auth/account-menu';
import { FIELDWORK_ROLE_LABEL, type AuthUser, type FieldworkRole } from '@/shared/contracts/auth';

interface Props {
  user: AuthUser;
  /** 소속 업체명 — 실사에게는 팀이 없어 이 값이 「어디 사람인가」다. */
  organization: string | null;
  role: FieldworkRole;
}

/**
 * 실사 콘솔의 헤더바 (.pen FLOW 10-1·10-2 공통).
 *
 * 홈과 열람 화면이 같은 바를 쓴다 — 사본이 둘이면 한쪽만 고쳐져 화면을 오갈 때 이름·배지가
 * 흔들린다. 클라이언트 훅을 쓰지 않으므로 서버 컴포넌트로 남긴다.
 */
export function FieldworkHeaderBar({ user, organization, role }: Props) {
  return (
    <header className="flex h-[56px] items-center justify-between border-b border-[#E5E5EA] bg-white px-6">
      <span className="text-[14px] font-semibold text-[#1C1C1E]">메가허브 실사</span>
      <AccountMenu
        name={user.name}
        affiliation={organization}
        badge={FIELDWORK_ROLE_LABEL[role]}
        // AuthUser.image 는 optional(표시 전용) — AccountMenu 는 값 유무만 보므로 접는다.
        image={user.image ?? null}
      />
    </header>
  );
}
