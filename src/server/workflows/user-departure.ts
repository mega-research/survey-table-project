import { sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { applyUserStatusChange } from '@/server/auth/services/users';
import { applySuccessionInTx } from '@/server/workspace/services/ownership';
import type { ChangeUserStatusInput, ChangeUserStatusOutput } from '@/shared/contracts/auth-io';

type DepartInput = Extract<ChangeUserStatusInput, { action: 'depart' }>;

/**
 * 승계 지정이 거부됐다 — 사유 문구만 보존해 감싼다.
 *
 * 재입사(`RehireTeamAssignmentError`)와 같은 이유다: 워크스페이스 도메인의 에러를 그대로
 * 올리면 auth procedure 가 그 도메인을 import 해야 하는데 그건 경계 위반이다. 화면은
 * 「같은 팀의 활성 멤버 또는 이 설문의 참여자에게만…」 같은 원래 문구를 그대로 본다.
 */
export class DepartureSuccessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DepartureSuccessionError';
  }
}

/**
 * 퇴사 — 상태 전이(auth)와 소유권 승계(workspace)를 **한 트랜잭션**으로 묶는다 (.pen 9-3).
 *
 * 두 도메인의 쓰기라 어느 서비스도 상대를 부를 수 없다(ESLint 경계). 재입사 워크플로와
 * 같은 자리, 같은 이유다.
 *
 * **나누면 안 되는 이유**: 퇴사만 커밋되고 승계가 실패하면 로그인도 못 하는 사람이 설문
 * 주인으로 남는다. 그 설문은 소유자가 살아 있으므로 승계 대기로도 안 잡히고, 재배치
 * 인박스에도 안 뜬다 — 어디에서도 보이지 않는 고아가 된다.
 *
 * **잠금 순서가 계약이다 — 전역 전이 키를 가장 먼저 잡는다.**
 *
 * 재입사가 「전역 키(user-status-transition) → 사용자 키 → 팀 키」로 잡고 "전역 키를 뒤에
 * 잡는 경로는 없다"를 불변식으로 적어 뒀다. 승계는 설문 행을 `FOR UPDATE` 로 잠그므로,
 * 그냥 두면 이 흐름만 「설문 → 전역 키」가 되어 그 문장이 깨진다. 그래서 트랜잭션 첫 줄에서
 * 같은 전역 키를 먼저 잡는다 — advisory **xact** 락은 같은 트랜잭션에서 재진입이 안전해,
 * 뒤이어 `applyUserStatusChange` 가 다시 잡아도 그대로 통과한다.
 *
 * 승계를 상태 전이보다 먼저 두는 것은 순서상 **필수는 아니다**. 둘이 한 트랜잭션이라 소유
 * 설문 조회는 어느 쪽이든 같은 스냅샷을 본다 — 실패를 빨리 드러내는 편이 낫다는 선택이다
 * (전수 대조가 어긋나면 상태를 건드리기 전에 멈춘다).
 */
export async function departUserWithSuccession(
  actor: { id: string },
  input: DepartInput,
): Promise<ChangeUserStatusOutput> {
  return db.transaction(async (tx) => {
    // 전역 전이 키를 먼저 — 아래 applyUserStatusChange 가 같은 키를 다시 잡는다(재진입 안전).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('user-status-transition')::bigint)`);
    try {
      await applySuccessionInTx(tx, actor.id, input.userId, input.succession);
    } catch (err) {
      throw new DepartureSuccessionError(
        err instanceof Error ? err.message : '소유 설문을 정리하지 못했습니다.',
      );
    }
    // 비밀번호 해시가 없는 전이라 잠금 구간 밖에서 미리 만들 것이 없다(재입사와 다른 점).
    return applyUserStatusChange(tx, actor.id, input, null);
  });
}
