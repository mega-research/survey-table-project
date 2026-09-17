import 'server-only';

import { eq } from 'drizzle-orm';

import { type DbOrTx, db } from '@/db';
import { surveys, users } from '@/db/schema';

/**
 * 이 설문의 **현재** 소유자 이메일 — 회신·문의 주소의 라이브 출처 (티켓 20).
 *
 * 값을 어디에도 박아두지 않는 것이 요점이다. 소유권이 이전되면(티켓 19) 그 다음 발송부터
 * 새 소유자에게 회신이 가야 하는데, 캠페인·설문 스냅샷에 이메일을 굳혀 두면 이전이 과거
 * 기록까지 거슬러 올라가거나(스냅샷을 고치는 경우) 영영 반영되지 않는다(고치지 않는 경우).
 * 그래서 읽는 시점에 조인해 읽는다.
 *
 * 도메인이 아니라 read-model 인 이유는 소비자가 둘 이상이라서다 — 메일 발송(mail)과 응답
 * 페이지 문의 주소(survey-builder). 도메인끼리는 서로를 부를 수 없다.
 *
 * **계정 상태를 묻지 않는다.** 퇴사 후 후임이 없으면 설문은 `succession_pending` 으로 서고
 * `owner_user_id` 는 떠난 사람 그대로 남는다(티켓 19) — 그 상태의 회신 주소는 「이전
 * 소유자」가 계약이다(티켓 20 체크리스트). 여기서 상태로 걸러 null 을 주면 회신이 조용히
 * 발신 주소로 떨어져, 답장이 아무도 읽지 않는 사서함에 쌓인다. 그 상황을 알리는 것은
 * 이 함수가 아니라 재배치 센터의 승계 대기 경고다.
 *
 * 소유자가 아예 없는 설문(팀 도입 이전 백필분, 0116 2단계 배포)은 null 이다.
 */
export async function getSurveyOwnerEmail(
  surveyId: string,
  executor: DbOrTx = db,
): Promise<string | null> {
  const rows = await executor
    .select({ email: users.email })
    .from(surveys)
    .innerJoin(users, eq(users.id, surveys.ownerUserId))
    .where(eq(surveys.id, surveyId))
    .limit(1);
  return rows[0]?.email ?? null;
}
