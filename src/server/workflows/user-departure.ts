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
 * **순서가 계약이다 — 승계가 먼저다.**
 * 재입사는 상태를 먼저 바꿨지만(배정이 재직 여부를 보므로) 여기는 반대다. 승계는 새 소유자의
 * 자격만 보고 **떠나는 사람의 상태는 보지 않으므로** 순서에 자유가 있는데, 승계를 먼저 두면
 * 「소유 설문 전수 대조」(applySuccessionInTx)가 **퇴사 이전의 목록**을 본다. 상태를 먼저
 * 바꾸면 그 사이 다른 요청이 설문을 넘길 수 있고, 그때 대조가 실패해 퇴사 전체가 롤백된다 —
 * 화면이 보여준 목록과 서버가 대조하는 목록을 같게 두는 쪽이 예측 가능하다.
 */
export async function departUserWithSuccession(
  actor: { id: string },
  input: DepartInput,
): Promise<ChangeUserStatusOutput> {
  return db.transaction(async (tx) => {
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
