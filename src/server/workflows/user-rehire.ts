import 'server-only';

import { db } from '@/db';
import { applyUserStatusChange, hashPassword } from '@/server/auth/services/users';
import { assignUserToTeamInTx } from '@/server/workspace/services/reassignment';
import type { ChangeUserStatusInput, ChangeUserStatusOutput } from '@/shared/contracts/auth-io';

type RehireInput = Extract<ChangeUserStatusInput, { action: 'rehire' }>;

/**
 * 팀 배정 단계에서 막혔다 — 계정은 여전히 퇴사 상태다(전체 롤백).
 *
 * 워크스페이스 도메인의 에러를 그대로 올려보내지 않는 이유는 경계다. 그 에러들을 auth
 * procedure 가 알아보게 하려면 auth 가 workspace 도메인을 import 해야 하는데 그건 금지다.
 * 그래서 이 층이 **사유 문구는 보존한 채** 자기 어휘로 감싼다 — 화면은 「해산된 팀입니다」
 * 같은 원래 문구를 그대로 보고, 경계는 그대로 남는다.
 */
export class RehireTeamAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RehireTeamAssignmentError';
  }
}

/**
 * 재입사 — 상태 전이(auth)와 팀 배정(workspace)을 **한 트랜잭션**으로 묶는다 (.pen FLOW 9-4).
 *
 * 두 도메인의 쓰기라 어느 한쪽 서비스가 상대를 부를 수 없다(ESLint 경계). 이 층이 존재하는
 * 이유가 정확히 그것이다.
 *
 * **나누면 안 되는 이유**: 퇴사는 유효 소속을 끊어놓았으므로 상태만 되돌리면 그 사람은
 * 로그인만 되는 미배치로 되살아난다. 화면(재입사 모달)은 「새 소속으로 다시 시작합니다」라고
 * 말하고 목적지 팀을 필수로 받으므로, 배정이 실패했는데 계정만 살아나는 창을 두면 그 약속이
 * 거짓이 된다. 실패는 전부 롤백되어 사용자는 여전히 퇴사 상태로 남는다.
 *
 * **순서가 계약이다.** 상태 전이를 먼저 한다 — 배정의 `assertMemberAssignable` 이 대상의
 * 재직 여부를 보기 때문이다. 뒤집으면 재입사가 자기 자신의 재직 검사(퇴사 상태)에 걸린다.
 *
 * 잠금 순서는 전이의 전역 키(user-status-transition) → 사용자 키 → 팀 키다. 팀원 추가
 * (addMember)가 사용자 → 팀 순으로 잡는 것과 어긋나지 않고, 전역 키를 뒤에 잡는 경로는 없다.
 *
 * 직책은 상태 전이 쪽이 쓴다 — 배정에는 넘기지 않아(undefined) 같은 열을 두 번 갱신하지 않는다.
 */
export async function rehireUserWithTeam(
  actor: { id: string; isSuperadmin: boolean },
  input: RehireInput,
): Promise<ChangeUserStatusOutput> {
  // 해시는 느리다 — 잠금 구간 밖에서 만든다(changeUserStatus 와 같은 이유).
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const result = await applyUserStatusChange(tx, actor.id, input, passwordHash);
    try {
      await assignUserToTeamInTx(tx, actor, {
        userId: input.userId,
        teamId: input.teamId,
        role: input.teamRole,
      });
    } catch (err) {
      throw new RehireTeamAssignmentError(
        err instanceof Error ? err.message : '새 소속 팀에 배정하지 못했습니다.',
      );
    }
    return result;
  });
}
