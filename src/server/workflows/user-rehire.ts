import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { users } from '@/db/schema';
import { applyUserStatusChange, hashPassword } from '@/server/auth/services/users';
import { clearActiveMembershipsInTx } from '@/server/workspace/services/members';
import { assignUserToTeamInTx } from '@/server/workspace/services/reassignment';
import type { ChangeUserStatusInput, ChangeUserStatusOutput } from '@/shared/contracts/auth-io';

type RehireInput = Extract<ChangeUserStatusInput, { action: 'rehire' }>;

/**
 * 재입사 입력이 대상의 유형과 맞지 않는다 — 팀이 필요한데 없거나, 팀이 금지인데 있다.
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
 * 이 계정이 팀에 소속될 수 있는가 — 재입사가 팀을 요구하는 기준.
 *
 * guest·fieldwork 는 멤버십 자체가 금지고(스펙 §1) 슈퍼어드민은 팀 소속과 무관한 전역
 * 관리자다(CONTEXT.md). 판정 자체는 `assertMemberAssignable` 이 다시 하지만, 그쪽은
 * "왜 안 되는가" 만 말할 뿐 "그러면 팀 없이 되살려도 되는가" 는 말해주지 않는다.
 */
function requiresTeamAssignment(target: { userType: string; isSuperadmin: boolean }): boolean {
  return target.userType === 'internal' && !target.isSuperadmin;
}

/**
 * 재입사 — 상태 전이(auth)와 팀 배정(workspace)을 **한 트랜잭션**으로 묶는다 (.pen FLOW 9-4).
 *
 * 두 도메인의 쓰기라 어느 한쪽 서비스가 상대를 부를 수 없다(ESLint 경계). 이 층이 존재하는
 * 이유가 정확히 그것이다.
 *
 * **나누면 안 되는 이유**: 화면은 「새 소속으로 다시 시작합니다」라고 말하고 목적지 팀을
 * 받는다. 배정이 실패했는데 계정만 살아나는 창을 두면 그 약속이 거짓이 된다. 실패는 전부
 * 롤백되어 사용자는 여전히 퇴사 상태로 남는다.
 *
 * **순서가 계약이다.**
 *  1. 상태 전이 — 배정의 `assertMemberAssignable` 이 대상의 재직 여부를 보므로 이게 먼저다.
 *     뒤집으면 재입사가 자기 자신의 재직 검사(퇴사 상태)에 걸린다.
 *  2. 옛 소속 정리 — 퇴사는 멤버십 행을 지우지 않는다(팀 상세가 비활성 멤버를 표식과 함께
 *     계속 보여주기 위해서다). 정리하지 않으면 배정이 「이미 다른 팀에 소속됨」으로 막혀
 *     **팀이 있던 사람은 아무도 재입사할 수 없다**. .pen 의 「이전 팀 멤버십은 자동 복구하지
 *     않습니다」도 이 정리가 있어야 참이 된다.
 *  3. 새 소속 배정.
 *
 * 잠금 순서는 전이의 전역 키(user-status-transition) → 사용자 키 → 팀 키(id 오름차순)다.
 * 팀원 추가(addMember)가 사용자 → 팀 순으로 잡는 것과 어긋나지 않고, 전역 키를 뒤에 잡는
 * 경로는 없다.
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

    // 유형은 전이가 잡은 행 잠금 아래에서 읽는다 — 대상이 없으면 위에서 이미 던졌다.
    const target = await tx.query.users.findFirst({
      where: eq(users.id, input.userId),
      columns: { userType: true, isSuperadmin: true },
    });
    if (!target) throw new RehireTeamAssignmentError('대상 사용자를 찾을 수 없습니다.');

    if (!requiresTeamAssignment(target)) {
      // 팀에 소속될 수 없는 계정이다. 팀을 보냈다면 화면이 규칙을 모르는 것이므로 조용히
      // 무시하지 않고 알린다 — 무시하면 "팀을 지정했는데 반영이 안 된다" 가 된다.
      if (input.teamId !== null) {
        throw new RehireTeamAssignmentError(
          '이 계정 유형은 팀에 소속되지 않습니다. 새 소속 팀 없이 재입사하세요.',
        );
      }
      return result;
    }

    if (input.teamId === null || input.teamRole === null) {
      throw new RehireTeamAssignmentError('새 소속 팀과 팀 역할을 지정하세요.');
    }

    try {
      await clearActiveMembershipsInTx(tx, actor.id, input.userId);
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
