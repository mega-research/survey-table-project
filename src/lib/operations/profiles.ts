/**
 * 운영 콘솔 응답 내역 페이지의 표시용 pure helper + 클라/서버 공용 타입.
 *
 * 'server-only' marker 는 `profiles.server.ts` 에만 둔다. 클라이언트 컴포넌트
 * (`profiles-filter-bar.tsx` 등) 가 import 해도 안전하도록 본 모듈은 DB/server-only
 * 의존을 일체 갖지 않는다.
 *
 * 단위 테스트: `tests/unit/domains/operations/profiles.test.ts`.
 */

import { buildRenderSteps, stepIdOf } from '@/lib/group-ordering';
import type { Question, QuestionGroup } from '@/types/survey';

// ─────────────────────────────────────────────────────────────────────────────
// 클라/서버 공용 타입 + 화이트리스트 (profiles.server.ts 와 client 양쪽이 사용)
// ─────────────────────────────────────────────────────────────────────────────

export const SORT_KEYS = [
  'idx',
  'platform',
  'browser',
  'startedAt',
  'completedAt',
  'totalSeconds',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type SortDir = 'asc' | 'desc';

export type ProfilesView = 'active' | 'deleted';

export const STATUS_FILTERS = [
  'all',
  'completed',
  'in_progress',
  'drop',
  'screened_out',
  'quotaful_out',
  'bad',
  'deleted',
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** UI 가 사용하는 고정 페이지 사이즈. URL 사용자 조작 차단. */
export const PROFILES_PAGE_SIZE = 20;

export function pickFromWhitelist<T extends string>(
  value: string | undefined,
  whitelist: readonly T[],
  fallback: T,
): T {
  return (whitelist as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

export interface NormalizedListArgs {
  page: number;
  q: string;
  /** 선택된 검색 컬럼 source (원시). 빈 문자열이면 미선택. 화이트리스트 검증은 server. */
  col: string;
  status: StatusFilter;
  sort: SortKey;
  dir: SortDir;
  /** status='deleted' 이면 'deleted', 그 외 전부 'active'. */
  view: ProfilesView;
}

/** `searchParams` 의 가공되지 않은 string 입력을 화이트리스트 + 기본값으로 normalize. */
export function normalizeListArgs(input: {
  page?: string;
  q?: string;
  col?: string;
  status?: string;
  sort?: string;
  dir?: string;
}): NormalizedListArgs {
  const status = pickFromWhitelist(input.status, STATUS_FILTERS, 'all');
  const view: ProfilesView = status === 'deleted' ? 'deleted' : 'active';
  return {
    page: Math.max(1, parseInt(input.page ?? '1', 10) || 1),
    q: (input.q ?? '').slice(0, 200),
    col: (input.col ?? '').slice(0, 100),
    status,
    sort: pickFromWhitelist(input.sort, SORT_KEYS, 'idx'),
    dir: input.dir === 'asc' ? 'asc' : 'desc',
    view,
  };
}

/** 현재 URL 의 검색 파라미터에 활성 필터가 걸려 있는지 판단.
 *  status='deleted' 도 활성 필터로 간주 (기본 뷰가 active 이므로).
 *  검색은 col + q 둘 다 있어야 발생한 것으로 간주.
 */
export function hasActiveFilters(input: {
  q?: string;
  col?: string;
  status?: string;
}): boolean {
  const hasSearch = (input.col ?? '') !== '' && (input.q ?? '') !== '';
  return hasSearch || (input.status ?? 'all') !== 'all';
}

// ─────────────────────────────────────────────────────────────────────────────
// 표시용 pure helper (입력만으로 출력 결정)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 응답 소요시간을 운영자 시점 표시 문자열로 변환.
 *
 * - `in_progress` → 항상 "진행 중" (소요시간 표기 무의미)
 * - `total_seconds = null` → "—"
 * - 음수 (시계 역행) → 0 으로 클램프
 * - 그 외 → 분 단위 반올림: "X분"
 *
 * 분 미만은 운영 가시성에 의미가 없어 정수 분으로만 표기.
 */
export function formatTotalTime(
  totalSeconds: number | null | undefined,
  status: string,
): string {
  if (status === 'in_progress') return '진행 중'
  if (totalSeconds === null || totalSeconds === undefined) return '—'
  const clamped = Math.max(0, totalSeconds)
  const minutes = Math.round(clamped / 60)
  return `${minutes}분`
}

const Q_NUMBER_RE = /^(Q\d+(?:-\d+)?)\b/

/**
 * question.title 의 prefix 에서 `Q3` / `Q5-1` / `Q33-1` 같은 질문번호를 추출한다.
 *
 * - 매치 실패 → null (notice 같은 비-Q 항목)
 * - prefix 가 아닌 곳에 Q 가 들어 있어도 매치 안 됨 (의도)
 */
export function parseQuestionNumberFromTitle(title: string | null | undefined): string | null {
  if (!title) return null
  const m = Q_NUMBER_RE.exec(title)
  return m ? (m[1] ?? null) : null
}

export type StatusTone = 'green' | 'blue' | 'gray' | 'amber' | 'red'

export interface StatusPillResult {
  label: string
  tone: StatusTone
  /** in_progress 일 때만 채워진다: "5/50 · Q3" */
  sub?: string
}

interface MapStatusPillArgs {
  status: string
  /** in_progress: visible step 현재 위치 (1-based, 분기/표시조건 반영). 없으면 ? */
  visibleStepIndex?: number | null
  /** in_progress: 현재까지 입력 기준 총 visible step 수. 없으면 ? */
  visibleStepTotal?: number | null
  /** 해당 survey 의 총 question 수 (괄호 안 표기). 없으면 ? */
  totalQuestions?: number | null
  /** "Q3" / "Q5-1" 같은 질문번호. parseQuestionNumberFromTitle 결과 */
  qNumber?: string | null
}

/**
 * 응답 status enum 6종 → 한국어 pill 메타데이터.
 *
 * 정의된 6종 외 값은 default fallback("기타", gray) — 향후 enum 확장 안전망.
 * `in_progress` 만 진척률 부속(`sub`)을 추가해 운영자에게 위치 단서를 준다.
 */
export function mapStatusPill(args: MapStatusPillArgs): StatusPillResult {
  const { status } = args
  switch (status) {
    case 'completed':
      return { label: '완료', tone: 'green' }
    case 'drop':
      return { label: '이탈', tone: 'gray' }
    case 'screened_out':
      return { label: '자격 미달', tone: 'amber' }
    case 'quotaful_out':
      return { label: '쿼터마감', tone: 'amber' }
    case 'bad':
      return { label: '불량', tone: 'red' }
    case 'in_progress': {
      // "26/28(50) · Q33" — visible step 진척 / 총 visible step (전체 질문 수) · 현재 질문번호.
      // visible 값은 응답 페이지가 저장 (구 데이터·첫 답변 전엔 NULL → '?' 폴백).
      const idx = args.visibleStepIndex ?? null
      const total = args.visibleStepTotal ?? null
      const totalQ = args.totalQuestions ?? null
      const q = args.qNumber ?? null
      const idxStr = idx === null ? '?' : String(idx)
      const totalStr = total === null ? '?' : String(total)
      const totalQStr = totalQ === null ? '?' : String(totalQ)
      const qStr = q === null ? '?' : q
      return { label: '진행중', tone: 'blue', sub: `${idxStr}/${totalStr}(${totalQStr}) · ${qStr}` }
    }
    default:
      return { label: '기타', tone: 'gray' }
  }
}

/** 응답자의 진행 위치(step) 한 곳을 질문 단위 표시로 환산한 결과. */
export interface StepLocation {
  /** 대표 질문(group step=첫 질문, table step=해당 질문)의 order. */
  order: number
  /** 대표 질문 title 에서 파싱한 "Q3" / "Q5-1" 등. 없으면 null. */
  qNumber: string | null
}

/**
 * buildStepLocationMap 입력 — DB row(InferSelectModel)와 도메인 타입(@/types/survey)을
 * 모두 수용하도록 buildRenderSteps 가 실제로 읽는 필드만 요구한다.
 */
export interface StepQuestionInput {
  id: string
  order: number
  title: string
  type: string
  groupId?: string | null
  pageBreakBefore?: boolean
}
export interface StepGroupInput {
  id: string
  order: number
  name: string
  parentGroupId?: string | null
}

/**
 * 진행 위치(`survey_responses.current_step_id`) → 질문 단위 표시 환산 맵.
 *
 * currentStepId 는 "페이지(step) ID"(`stepIdOf` 컨벤션: 'page:<페이지 첫 질문 id>')로
 * 저장되므로 순수 question.id 로는 매칭되지 않는다.
 * 응답 페이지와 동일한 `buildRenderSteps` 로 step 목록을 만들고, 각 step 의 stepId 를
 * 그 step 의 대표 질문 order/질문번호에 매핑한다. (각 페이지의 첫 질문이 대표)
 */
export function buildStepLocationMap(
  questions: StepQuestionInput[],
  groups: StepGroupInput[],
): Map<string, StepLocation> {
  // buildRenderSteps 는 @/types/survey 도메인 타입을 받으므로, 읽히는 필드만 정규화한다.
  // (surveyId/required 등은 step 구성에서 미사용 — 더미로 채워 타입만 만족)
  const qs: Question[] = questions.map((q) => ({
    id: q.id,
    order: q.order,
    title: q.title,
    type: q.type as Question['type'],
    required: false,
    ...(q.groupId != null ? { groupId: q.groupId } : {}),
    ...(q.pageBreakBefore ? { pageBreakBefore: true } : {}),
  }))
  const gs: QuestionGroup[] = groups.map((g) => ({
    id: g.id,
    surveyId: '',
    name: g.name,
    order: g.order,
    ...(g.parentGroupId != null ? { parentGroupId: g.parentGroupId } : {}),
  }))
  const map = new Map<string, StepLocation>()
  for (const step of buildRenderSteps(qs, gs)) {
    const rep = step.items[0]?.question
    if (!rep) continue
    map.set(stepIdOf(step), { order: rep.order, qNumber: parseQuestionNumberFromTitle(rep.title) })
  }
  return map
}
