import { and, eq, isNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveys } from '@/db/schema';

import {
  type SetSurveyVisibilityInput,
  SharingSurveyNotFoundError,
  type WorkspaceActionOutput,
} from '../domain/sharing';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 설문 공개 범위 변경 (.pen FLOW 4-2, 티켓 16).
 *
 * 권한 판정은 procedure 의 `survey.manageAccess` 관문이 전부 끝냈다 — 여기서 소유자·팀장을
 * 다시 묻지 않는다(매트릭스가 두 벌이 된다). 이 함수가 지는 것은 두 가지뿐이다.
 *
 * ① **삭제된 설문은 만지지 않는다.** 관문이 이미 `deletedAt IS NULL` 로 조회하므로 평소에는
 *    여기까지 오지 않는다 — WHERE 의 같은 조건은 **관문과 이 UPDATE 사이 창**에서 삭제가
 *    커밋된 경우를 위한 두 번째 겹이다. 0행을 조용히 성공으로 접으면 화면은 저장됐다고 말하고
 *    목록에는 아무 변화가 없어, 저장이 안 됐다는 사실이 어디에도 남지 않는다.
 *
 * ② **`updatedAt` 을 건드리지 않는다.** 공개 범위는 설문 내용이 아니라 누가 보는가의
 *    문제다. 그룹 이동이 같은 이유로 손대지 않는 자리이고(티켓 12), 건드리면 「최신 수정순」
 *    기본 정렬이 공유 설정 한 번에 뒤집힌다.
 *
 * 감사 행은 남기지 않는다 — `survey_ownership_events` 의 어휘는 소유 **이동**
 * (unassign·assign·transfer)이고 공개 범위 변경은 그 축이 아니다. 억지로 끼우면 재배치
 * 센터가 읽는 계보에 이동이 아닌 사건이 섞인다.
 */
export async function setSurveyVisibility(
  input: SetSurveyVisibilityInput,
): Promise<WorkspaceActionOutput> {
  const updated = await db
    .update(surveys)
    .set({ visibility: input.visibility })
    .where(and(eq(surveys.id, input.surveyId), isNull(surveys.deletedAt)))
    .returning({ id: surveys.id });

  if (updated.length === 0) throw new SharingSurveyNotFoundError();
  return OK;
}
