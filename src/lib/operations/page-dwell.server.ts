import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveys, surveyVersions } from '@/db/schema';

import {
  buildCanonicalSteps,
  formatPageDwell,
  type DwellOutput,
  type DwellStats,
} from './page-dwell';

/** 빈 결과 — published version이 없거나 snapshot이 비어있을 때. */
const EMPTY_OUTPUT: DwellOutput = { pages: [] };

/** 양쪽 트리밍 비율 — page-dwell.ts 의 DEFAULT_TRIM 과 동일. */
const TRIM = 0.025;

/**
 * 단일 설문의 페이지별 체류시간 분포를 반환한다 (서버 전용).
 *
 * 처리 단계:
 *   A) surveys.currentVersionId → surveyVersions.snapshot 로드 + 캐노니컬 step 빌드.
 *   B) SQL window function 으로 stepId 별 trimmed 통계 직접 산출.
 *      - LATERAL jsonb_array_elements 로 pageVisits 펼침.
 *      - leftAt > enteredAt 필터로 미완료/잘못된 visit 제외.
 *      - (response_id, step_id) 로 SUM 집계 → 한 응답이 같은 step 을 여러 visit
 *        으로 가지면 합산해 1표본으로. 세그먼트 재방문으로 인한 표본 과다 방지.
 *      - PARTITION BY step_id 의 ROW_NUMBER + COUNT 로 trim 범위 결정.
 *      - AVG/STDDEV_SAMP FILTER 로 trimmed 평균 + 표본 SD 산출.
 *   C) JS 측에서 캐노니컬 순서 보존 + n=0 step fallback (formatPageDwell).
 *
 * Notes:
 *   - in_progress 응답은 leftAt 누락이 잦아 통계 왜곡 → status IN ('completed', 'drop') 만 사용.
 *   - drop 의 마지막 visit 는 leftAt 미설정 가능 → SQL WHERE 절이 자동 skip.
 *   - SQL FILTER 조건은 page-dwell.ts 의 `trimmedStats` 와 동등:
 *     JS slice(trimCount, n - trimCount) ⇔ SQL rn > trimCount AND rn <= n - trimCount.
 */
export async function getPageDwell(surveyId: string): Promise<DwellOutput> {
  // ── A) snapshot 로드 + 캐노니컬 step ─────────────────────────────────────
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
  if (!snapshot) return EMPTY_OUTPUT;

  const steps = buildCanonicalSteps(snapshot);
  if (steps.length === 0) return EMPTY_OUTPUT;

  // ── B) SQL trimmed 통계 직접 산출 ────────────────────────────────────────
  const rows = await db.execute(sql`
    WITH dwell AS (
      SELECT
        sr.id AS response_id,
        visit->>'stepId' AS step_id,
        SUM(EXTRACT(EPOCH FROM ((visit->>'leftAt')::timestamptz - (visit->>'enteredAt')::timestamptz))) AS seconds
      FROM survey_responses sr,
      LATERAL jsonb_array_elements(sr.page_visits) AS visit
      WHERE sr.survey_id = ${surveyId}::uuid
        AND sr.status IN ('completed', 'drop')
        AND jsonb_array_length(sr.page_visits) > 0
        AND visit->>'stepId' IS NOT NULL
        AND visit->>'leftAt' IS NOT NULL
        AND visit->>'leftAt' <> ''
        AND visit->>'enteredAt' IS NOT NULL
        AND (visit->>'leftAt')::timestamptz > (visit->>'enteredAt')::timestamptz
      GROUP BY sr.id, visit->>'stepId'
    ),
    ranked AS (
      SELECT
        step_id,
        seconds,
        ROW_NUMBER() OVER (PARTITION BY step_id ORDER BY seconds) AS rn,
        COUNT(*) OVER (PARTITION BY step_id) AS total_n
      FROM dwell
    )
    SELECT
      step_id,
      COUNT(*) FILTER (
        WHERE rn > floor(total_n * ${TRIM}::float8)::int
          AND rn <= total_n - floor(total_n * ${TRIM}::float8)::int
      )::int AS n_trimmed,
      AVG(seconds) FILTER (
        WHERE rn > floor(total_n * ${TRIM}::float8)::int
          AND rn <= total_n - floor(total_n * ${TRIM}::float8)::int
      ) AS mean_seconds,
      STDDEV_SAMP(seconds) FILTER (
        WHERE rn > floor(total_n * ${TRIM}::float8)::int
          AND rn <= total_n - floor(total_n * ${TRIM}::float8)::int
      ) AS sd_seconds
    FROM ranked
    GROUP BY step_id
  `);

  // ── C) statsMap 빌드 + formatPageDwell ─────────────────────────────────
  const validStepIds = new Set(steps.map((s) => s.stepId));
  const statsMap = new Map<string, DwellStats>();

  for (const row of rows as unknown as Array<{
    step_id: string;
    n_trimmed: number | string;
    mean_seconds: number | string | null;
    sd_seconds: number | string | null;
  }>) {
    if (!validStepIds.has(row.step_id)) continue;
    const n = Number(row.n_trimmed);
    if (n === 0) continue;
    statsMap.set(row.step_id, {
      n,
      mean: row.mean_seconds === null ? null : Number(row.mean_seconds),
      sd: row.sd_seconds === null ? null : Number(row.sd_seconds),
    });
  }

  return formatPageDwell(steps, statsMap);
}
