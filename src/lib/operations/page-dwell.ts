/**
 * 운영 현황 콘솔 — A6 페이지별 체류시간 분포 위젯을 위한 집계.
 *
 * 위젯 정의 (plan §5):
 *   x축 = 페이지(RenderStep) 라벨, snapshot 기반 캐노니컬 순서.
 *   y축 = 평균 체류시간(초). ErrorBar = ± SD.
 *   상하 2.5% 트리밍.
 *
 * 파일 구성:
 *   - 본 파일: 타입 정의 + 순수 변환 함수 (`trimmedStats`, `shapePageDwell`)
 *     서버 의존성 없음 → 단위 테스트 대상.
 *   - `page-dwell.server.ts`: DB 어댑터 `getPageDwell`.
 *
 * 정책 (plan §5, §10):
 *   - **stepId 컨벤션** (응답 페이지 `stepIdOf`와 일치):
 *     - 신모델: `'page:' + 페이지 첫 질문 id`. 구 'group:'/'table:' stepId는 미상 처리.
 *   - **캐노니컬 순서**: `buildRenderSteps`/`stepIdOf` 위임. 각 RenderStep(한 페이지)이 CanonicalStep 1개.
 *   - **체류시간 산출**: 각 PageVisit의 `(leftAt - enteredAt) / 1000`.
 *     - leftAt 미정의 / leftAt ≤ enteredAt → skip.
 *     - 비유한 값은 사전 필터.
 *   - **트리밍**: 양 끝에서 floor(n × trim) 개씩 제거 후 평균/SD 계산.
 *     n < 40 (trim=0.025 기준) 이면 floor=0이라 제거 없음.
 *   - **SD 정의**: 표본 SD (n-1 분모). n < 2 → SD = null.
 *   - **n=0 step**: snapshot 순서를 보존하기 위해 `pages`에 포함. 모든 통계 null.
 *   - 결과 정렬은 캐노니컬 순서 (mean 정렬 X) — 차트 x축 구조 보존.
 */

import type {
  PageVisit,
  SurveyVersionSnapshot,
} from '@/db/schema/schema-types';
import { buildRenderSteps, stepIdOf } from '@/lib/group-ordering';
import type { Question, QuestionGroup } from '@/types/survey';

import { validVisitMs } from './active-seconds';

/** 한 페이지(RenderStep)의 체류시간 통계. */
export interface DwellPage {
  /** stepId — 신모델: 'page:<페이지 첫 질문 id>'. */
  stepId: string;
  /** 차트 라벨. 페이지 첫 항목의 rootGroupName → questionCode → 'Q<position>'. */
  label: string;
  /** 캐노니컬 순서 내 1-based 위치. */
  position: number;
  /**
   * 소속 페이지 번호 (1-based).
   * 신모델: 각 step이 곧 한 페이지이므로 position과 동일.
   */
  page: number | null;
  /** 트리밍 적용 후 표본 수. */
  n: number;
  /** 평균 체류시간(초). n=0 → null. */
  meanSeconds: number | null;
  /** 표본 표준편차(초). n < 2 → null. */
  sdSeconds: number | null;
}

export interface DwellInput {
  /** 행마다 한 응답의 pageVisits. (status='completed'|'drop'만 받는 것을 권장) */
  responses: Array<{ pageVisits: PageVisit[] | null }>;
  /** 현재 published version snapshot — 캐노니컬 step 순서의 출처. */
  snapshot: SurveyVersionSnapshot;
  /** 트리밍 비율 (양쪽). 기본 0.025 (response-time과 동일). */
  trim?: number;
}

export interface DwellOutput {
  pages: DwellPage[];
}

/** 기본 트리밍 비율 — response-time.ts와 동일. */
const DEFAULT_TRIM = 0.025;

/** trimmed 평균 + SD를 한 번에 계산한다 (원본 배열 미변형). */
export function trimmedStats(
  values: number[],
  trim: number,
): { n: number; mean: number | null; sd: number | null } {
  // 비유한 값 제거.
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { n: 0, mean: null, sd: null };

  const sorted = [...finite].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trim);
  const sliced = sorted.slice(trimCount, sorted.length - trimCount);
  // 방어적: trim < 0.5 인 한 sliced.length > 0.
  if (sliced.length === 0) return { n: 0, mean: null, sd: null };

  const n = sliced.length;
  const sum = sliced.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;

  // 표본 SD (n-1 분모). n < 2면 정의 불가.
  if (n < 2) {
    return { n, mean, sd: null };
  }
  let sqSum = 0;
  for (const v of sliced) {
    const d = v - mean;
    sqSum += d * d;
  }
  const sd = Math.sqrt(sqSum / (n - 1));
  return { n, mean, sd };
}

/** 캐노니컬 순서로 정렬된 step 식별자 + 라벨 + 페이지 번호. */
export interface CanonicalStep {
  stepId: string;
  label: string;
  position: number;
  /** 소속 페이지 번호 (1-based). 신모델: position과 동일. */
  page: number | null;
}

/** trimmed mean + sample SD 단일 step 통계. */
export interface DwellStats {
  n: number;
  mean: number | null;
  sd: number | null;
}

/**
 * snapshot에서 캐노니컬 RenderStep 순서를 추출한다.
 *
 * 신모델: `buildRenderSteps`/`stepIdOf` 위임. 각 RenderStep(= 한 페이지)이 곧 한 CanonicalStep.
 * stepId 컨벤션: 'page:<페이지 첫 질문 id>' (응답 페이지 `stepIdOf`와 동일).
 *
 * 라벨 규칙 (멀티라인 X축 분리 기준):
 *   - 페이지 첫 항목의 rootGroupName → questionCode → 'Q<position>'.
 *
 * Edge:
 *   - 그룹/질문 0건 → [] 반환.
 *   - 구 응답의 'group:'/'table:' stepId는 validStepIds에 없어 무시(legacyCount 처리는 소비처 담당).
 */
export function buildCanonicalSteps(snapshot: SurveyVersionSnapshot): CanonicalStep[] {
  const rawGroups = Array.isArray(snapshot.groups) ? snapshot.groups : [];
  const rawQuestions = Array.isArray(snapshot.questions) ? snapshot.questions : [];

  // buildRenderSteps 가 읽는 필드만 도메인 형태로 정규화한다 (profiles.ts 와 동일 패턴).
  const qs: Question[] = rawQuestions.map((q) => ({
    id: q.id,
    order: q.order,
    title: q.title,
    type: q.type as Question['type'],
    required: false,
    ...(q.groupId != null ? { groupId: q.groupId } : {}),
    ...(q.pageBreakBefore ? { pageBreakBefore: true } : {}),
  }));
  const gs: QuestionGroup[] = rawGroups.map((g) => ({
    id: g.id,
    surveyId: '',
    name: g.name,
    order: g.order,
    ...(g.parentGroupId != null ? { parentGroupId: g.parentGroupId } : {}),
    ...((g as { hideName?: boolean }).hideName ? { hideName: true } : {}),
  }));

  const questionCodeOf = new Map<string, string | undefined>(
    rawQuestions.map((q) => [q.id, (q as { questionCode?: string }).questionCode]),
  );

  const steps: CanonicalStep[] = [];
  buildRenderSteps(qs, gs).forEach((step, idx) => {
    const first = step.items[0];
    if (!first) return;
    const position = idx + 1;
    const code = questionCodeOf.get(first.question.id);
    const label = first.rootGroupName ?? code ?? `Q${position}`;
    steps.push({
      stepId: stepIdOf(step),
      label,
      position,
      page: position, // 신모델: 각 step 이 곧 한 페이지
    });
  });
  return steps;
}

/**
 * 응답 raw pageVisits 를 stepId 별 trimmed 통계 Map 으로 집계.
 *
 * - validStepIds 에 없는 stepId 는 무시 (legacy / version mismatch).
 * - leftAt 누락 / leftAt ≤ enteredAt / 비유한 timestamp → skip.
 * - 빈 step (n=0 이후) 은 결과 Map 에 포함하지 않음 — formatPageDwell 이 fallback 처리.
 *
 * 이 함수는 server SQL 집계와 동일 동작을 JS 로 재현하며,
 * server 가 SQL window function 으로 같은 결과를 직접 산출하는 경우 호출되지 않음.
 */
export function aggregatePageDwell(
  responses: DwellInput['responses'],
  validStepIds: ReadonlySet<string>,
  trim: number = DEFAULT_TRIM,
): Map<string, DwellStats> {
  const buckets = new Map<string, number[]>();

  for (const resp of responses) {
    const visits = resp.pageVisits;
    if (!Array.isArray(visits) || visits.length === 0) continue;

    // 응답 내 stepId 별 활성시간 합산 (세그먼트 분할/재방문을 표본 1개로 묶는다).
    // visit 유효성/시간 파싱은 validVisitMs로 위임 — sumActiveSeconds와 동일 판정.
    const perStep = new Map<string, number>();
    for (const visit of visits) {
      if (!visit || typeof visit.stepId !== 'string') continue;
      if (!validStepIds.has(visit.stepId)) continue;
      const ms = validVisitMs(visit);
      if (!ms) continue;
      perStep.set(
        visit.stepId,
        (perStep.get(visit.stepId) ?? 0) + (ms.leftMs - ms.enteredMs) / 1000,
      );
    }

    for (const [stepId, seconds] of perStep) {
      let bucket = buckets.get(stepId);
      if (!bucket) {
        bucket = [];
        buckets.set(stepId, bucket);
      }
      bucket.push(seconds);
    }
  }

  const stats = new Map<string, DwellStats>();
  for (const [stepId, values] of buckets) {
    stats.set(stepId, trimmedStats(values, trim));
  }
  return stats;
}

/**
 * 캐노니컬 step 순서 + stepId 별 통계 Map → DwellOutput.
 *
 * - statsMap 에 없는 stepId 는 n=0/mean=null/sd=null fallback 으로 출력에 포함
 *   (snapshot 순서 보존 — 차트 x 축 구조).
 */
export function formatPageDwell(
  steps: CanonicalStep[],
  statsMap: Map<string, DwellStats>,
): DwellOutput {
  const pages: DwellPage[] = steps.map((step) => {
    const stats = statsMap.get(step.stepId) ?? { n: 0, mean: null, sd: null };
    return {
      stepId: step.stepId,
      label: step.label,
      position: step.position,
      page: step.page,
      n: stats.n,
      meanSeconds: stats.mean,
      sdSeconds: stats.sd,
    };
  });
  return { pages };
}

/**
 * 응답들의 pageVisits 를 받아 페이지별 체류시간 분포를 계산한다.
 *
 * buildCanonicalSteps + aggregatePageDwell + formatPageDwell 합성. 기존 단위 테스트 호환 wrapper.
 * server SQL 집계 경로는 aggregatePageDwell 을 우회하고 formatPageDwell 만 호출한다.
 */
export function shapePageDwell(input: DwellInput): DwellOutput {
  const trim = input.trim ?? DEFAULT_TRIM;
  const steps = buildCanonicalSteps(input.snapshot);
  if (steps.length === 0) return { pages: [] };
  const validStepIds = new Set(steps.map((s) => s.stepId));
  const statsMap = aggregatePageDwell(input.responses, validStepIds, trim);
  return formatPageDwell(steps, statsMap);
}
