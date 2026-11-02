import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import 'server-only';

import { surveys } from '@/db/schema';
import {
  type SurveyListLifecycle,
  normalizeSurveyListLifecycle,
} from '@/shared/contracts/survey-builder-io';

type LifecycleOperand = AnyColumn | SQL;

/**
 * 목록 상태(작성중 · 진행중 · 종료)의 **SQL 식** — `resolveSurveyListLifecycle`(TS)의 짝.
 *
 * 두 벌이 같은 순서로 같은 표를 지난다(`tests/fixtures/survey-list-lifecycle-cases` —
 * TS 는 단위 테스트, 이 식은 `survey-list-lifecycle.realdb.test.ts`). 한쪽을 고치면 다른 쪽도.
 *
 *  1. 모르는 status 값 · draft · 배포 버전 없음 → 'draft' (TS 의 `normalizeSurveyStatus` 접힘과 같다)
 *  2. 종료 스위치(closed) → 'closed'
 *  3. 마감일 경과(`end_date < now`) → 'closed' — 일시 중단은 보지 않는다(진행중)
 *  4. 나머지 → 'running'
 *
 * 기본 입력은 `surveys` 의 열과 `now()` 다 — 목록 조회의 투영·WHERE·집계에 그대로 꽂는다.
 * 인자는 테스트가 리터럴을 꽂거나 별칭 테이블을 쓸 때만 넘긴다.
 * 결과는 text 이고 `mapWith` 가 어휘로 접는다(투영에서 `SurveyListLifecycle` 로 나온다).
 */
export function surveyListLifecycleSql(
  cols: {
    status: LifecycleOperand;
    currentVersionId: LifecycleOperand;
    endDate: LifecycleOperand;
  } = {
    status: surveys.status,
    currentVersionId: surveys.currentVersionId,
    endDate: surveys.endDate,
  },
  now: SQL = sql`now()`,
): SQL<SurveyListLifecycle> {
  return sql<SurveyListLifecycle>`(case
    when ${cols.status} is null or ${cols.status} not in ('published', 'closed') or ${cols.currentVersionId} is null then 'draft'
    when ${cols.status} = 'closed' then 'closed'
    when ${cols.endDate} is not null and ${cols.endDate} < ${now} then 'closed'
    else 'running'
  end)`.mapWith((value: string) => normalizeSurveyListLifecycle(value));
}
