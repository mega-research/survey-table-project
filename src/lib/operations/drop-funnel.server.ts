import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveys, surveyVersions } from '@/db/schema';

import {
  formatDropFunnel,
  type DropFunnelOutput,
  type FunnelQuestion,
} from './drop-funnel';
import { buildCanonicalSteps } from './page-dwell';

/** 빈 결과 — published version 없거나 snapshot이 비어있을 때. */
const EMPTY_OUTPUT: DropFunnelOutput = { bars: [], totalDrops: 0 };

/**
 * 단일 설문의 Drop funnel 데이터를 반환한다 (서버 전용).
 *
 * 처리 단계:
 *   A) surveys.currentVersionId → surveyVersions.snapshot 에서 캐노니컬 step 추출.
 *      page-dwell 과 동일한 buildCanonicalSteps → stepId 체계 일치.
 *   B) SQL 로 drop 세션의 *마지막 pageVisit stepId* 별 COUNT 집계.
 *      - response_answers 는 응답 완료 시에만 채워져 drop(미완료)은 비어있다.
 *        그래서 마지막 pageVisit(`page_visits -> -1 ->> 'stepId'`)을 이탈 위치로 귀속한다.
 *        firstVisit 이 항상 currentStepId 로 생성되므로 drop 도 거의 항상 pageVisit ≥1개를 가진다.
 *      - exposedQuestionIds 필터는 제거. 귀속 신호가 "답변→도달 페이지"로 바뀌어 전제가 사라졌다
 *        (미도달 페이지는 애초에 pageVisit 이 없으므로 거짓 귀속 위험이 없다).
 *   C) JS 측에서 validStepIds 비교로 legacy 분류 → formatDropFunnel 에 위임.
 *
 * Edge case:
 *   - currentVersionId 없음 / snapshot 비어있음 → 빈 결과.
 *   - drop 세션 0건이어도 formatDropFunnel 이 빈 bars 를 반환.
 *
 * `sr.is_test = false` — 테스트 응답은 drop funnel 모수에서 제외(notTestResponse 와 동일
 * 의미, raw SQL 컨텍스트라 인라인 유지).
 */
export async function getDropFunnel(surveyId: string): Promise<DropFunnelOutput> {
  // ── A) 현재 published snapshot 로드 + 캐노니컬 step ──────────────────────────
  const surveyRow = await db
    .select({ currentVersionId: surveys.currentVersionId })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);

  const currentVersionId = surveyRow[0]?.currentVersionId;
  if (!currentVersionId) return EMPTY_OUTPUT;

  const versionRow = await db
    .select({ snapshot: surveyVersions.snapshot })
    .from(surveyVersions)
    .where(eq(surveyVersions.id, currentVersionId))
    .limit(1);

  const snapshot = versionRow[0]?.snapshot ?? null;
  // 위치 목록 = 캐노니컬 step (page-dwell와 동일 stepId 체계). FunnelQuestion.id에 stepId를 담는다.
  const steps = snapshot ? buildCanonicalSteps(snapshot) : [];
  const questions: FunnelQuestion[] = steps.map((s) => ({
    id: s.stepId,
    position: s.position,
    label: s.label,
    ...(s.page !== undefined && s.page !== null ? { page: s.page } : {}),
  }));
  if (questions.length === 0) return EMPTY_OUTPUT;

  // ── B) SQL 위치별 COUNT 집계 (마지막 pageVisit stepId) ───────────────────────
  const aggregateRows = await db.execute(sql`
    SELECT
      COALESCE(sr.page_visits, '[]'::jsonb) -> -1 ->> 'stepId' AS last_step_id,
      COUNT(*)::int AS cnt
    FROM survey_responses sr
    WHERE sr.survey_id = ${surveyId}::uuid AND sr.status = 'drop' AND sr.is_test = false
    GROUP BY COALESCE(sr.page_visits, '[]'::jsonb) -> -1 ->> 'stepId'
  `);

  // ── C) JS 분류: counts (정상 위치) vs legacyCount (snapshot 부재 / null) ──
  const validStepIds = new Set(questions.map((q) => q.id));
  const counts = new Map<string, number>();
  let legacyCount = 0;
  let totalDrops = 0;

  for (const row of aggregateRows as unknown as Array<{
    last_step_id: string | null;
    cnt: number;
  }>) {
    const id = row.last_step_id;
    const cnt = Number(row.cnt);
    totalDrops += cnt;
    if (id === null || !validStepIds.has(id)) {
      legacyCount += cnt;
    } else {
      counts.set(id, cnt);
    }
  }

  return formatDropFunnel({ questions, counts, legacyCount, totalDrops });
}
