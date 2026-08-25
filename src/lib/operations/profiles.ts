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
  'resid',
  'group',
  'platform',
  'browser',
  'status',
  'startedAt',
  'completedAt',
  'totalSeconds',
] as const;
export type ProfilesSystemSortKey = (typeof SORT_KEYS)[number];

/** 시스템 키 또는 'attrs.<key>' (컨택 attrs 자연 정렬 — 조사 대상과 동일 축). */
export type SortKey = ProfilesSystemSortKey | `attrs.${string}`;

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
    // attrs.<key> 는 표시 스킴 검증(고아 URL 가드)을 page 에서 수행 — 여기선 형태만 수용.
    sort:
      input.sort?.startsWith('attrs.') && input.sort.length <= 200
        ? (input.sort as SortKey)
        : pickFromWhitelist(input.sort, SORT_KEYS, 'idx'),
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
  /** 진행중·이탈일 때 채워진다: "5/50(11) · Q3" — 이탈은 멈춘 위치 표시 */
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
/**
 * 진척 부속 표기 — "26/28(50) · Q33": visible step 진척 / 총 visible step (전체 질문 수) · 현재 질문번호.
 * visible 값은 응답 페이지가 저장 (구 데이터·첫 답변 전엔 NULL → '?' 폴백).
 * 진행중·이탈 pill 이 공유한다 (이탈 = 그 위치에서 멈춘 진행중).
 * 위치 신호가 전혀 없으면 null — 이탈은 sub 생략, 진행중은 '?' 폴백 유지(기존 동작).
 */
function buildProgressSub(args: MapStatusPillArgs): string | null {
  const idx = args.visibleStepIndex ?? null
  const total = args.visibleStepTotal ?? null
  const totalQ = args.totalQuestions ?? null
  const q = args.qNumber ?? null
  if (idx === null && total === null && q === null) return null
  const idxStr = idx === null ? '?' : String(idx)
  const totalStr = total === null ? '?' : String(total)
  const totalQStr = totalQ === null ? '?' : String(totalQ)
  const qStr = q === null ? '?' : q
  return `${idxStr}/${totalStr}(${totalQStr}) · ${qStr}`
}

export function mapStatusPill(args: MapStatusPillArgs): StatusPillResult {
  const { status } = args
  switch (status) {
    case 'completed':
      return { label: '완료', tone: 'green' }
    case 'drop': {
      const sub = buildProgressSub(args)
      return { label: '이탈', tone: 'gray', ...(sub !== null ? { sub } : {}) }
    }
    case 'screened_out':
      return { label: '자격 미달', tone: 'amber' }
    case 'quotaful_out':
      return { label: '쿼터마감', tone: 'amber' }
    case 'bad':
      return { label: '불량', tone: 'red' }
    case 'in_progress':
      return { label: '진행중', tone: 'blue', sub: buildProgressSub(args) ?? '?/?(?) · ?' }
    default:
      return { label: '기타', tone: 'gray' }
  }
}

/**
 * 엑셀 export 상태 라벨 — 콘솔 pill 어휘(mapStatusPill)를 따르되, 자격 미달은
 * 스크리닝으로 설문을 정상 종결한 응답이라 export 에서는 완료 계열로 표기한다.
 * rawdata 엑셀(raw-workbook)과 조사 대상 엑셀(contacts-export)이 공유한다.
 */
export function formatExportStatusLabel(status: string): string {
  if (status === 'screened_out') return '완료(자격 미달)'
  return mapStatusPill({ status }).label
}

/** 응답자의 진행 위치(step) 한 곳을 질문 단위 표시로 환산한 결과. */
export interface StepLocation {
  /** 대표 질문(group step=첫 질문, table step=해당 질문)의 order. */
  order: number
  /** 대표 질문의 질문코드 우선("Q3" 등), 없으면 title 에서 파싱한 Qx. 둘 다 없으면 null. */
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
  pageBreakBefore?: boolean | null
  /** 질문코드 (SPSS 변수 코드). 있으면 qNumber 로 제목 파싱보다 우선 사용된다. */
  questionCode?: string | null
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
  // 라벨은 페이지 항목 순서대로 질문코드 우선, 없으면 제목 Qx 파싱을 시도해 첫 성공값을 쓴다.
  // 페이지 첫 항목이 코드 없는 공지여도 같은 페이지의 코드 있는 문항으로 라벨이 잡힌다.
  // 정규화된 item.question 에는 questionCode 가 없어 원본을 역참조한다.
  const byId = new Map(questions.map((q) => [q.id, q]))
  const map = new Map<string, StepLocation>()
  for (const step of buildRenderSteps(qs, gs)) {
    const rep = step.items[0]?.question
    if (!rep) continue
    let qNumber: string | null = null
    for (const item of step.items) {
      qNumber =
        byId.get(item.question.id)?.questionCode ||
        parseQuestionNumberFromTitle(item.question.title) ||
        null
      if (qNumber) break
    }
    map.set(stepIdOf(step), { order: rep.order, qNumber })
  }
  return map
}
