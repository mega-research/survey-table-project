/**
 * 운영 콘솔 응답 내역 페이지의 표시용 pure helper + 클라/서버 공용 타입.
 *
 * 'server-only' marker 는 `profiles.server.ts` 에만 둔다. 클라이언트 컴포넌트
 * (`profiles-filter-bar.tsx` 등) 가 import 해도 안전하도록 본 모듈은 DB/server-only
 * 의존을 일체 갖지 않는다.
 *
 * 단위 테스트: `tests/unit/domains/operations/profiles.test.ts`.
 */

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

export const QFIELDS = ['all', 'idx', 'browser'] as const;
export type QField = (typeof QFIELDS)[number];

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
  qfield: QField;
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
  qfield?: string;
  status?: string;
  sort?: string;
  dir?: string;
}): NormalizedListArgs {
  const status = pickFromWhitelist(input.status, STATUS_FILTERS, 'all');
  const view: ProfilesView = status === 'deleted' ? 'deleted' : 'active';
  return {
    page: Math.max(1, parseInt(input.page ?? '1', 10) || 1),
    q: (input.q ?? '').slice(0, 200),
    qfield: pickFromWhitelist(input.qfield, QFIELDS, 'all'),
    status,
    sort: pickFromWhitelist(input.sort, SORT_KEYS, 'idx'),
    dir: input.dir === 'asc' ? 'asc' : 'desc',
    view,
  };
}

/** 현재 URL 의 검색 파라미터에 활성 필터가 걸려 있는지 판단.
 *  status='deleted' 도 활성 필터로 간주 (기본 뷰가 active 이므로).
 */
export function hasActiveFilters(input: {
  q?: string;
  qfield?: string;
  status?: string;
}): boolean {
  return (
    (input.q ?? '') !== '' ||
    (input.qfield ?? 'all') !== 'all' ||
    (input.status ?? 'all') !== 'all'
  );
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
  return m ? m[1] : null
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
  /** in_progress 일 때 question.order (1-based). 없으면 ?로 표기 */
  currentStepOrder?: number | null
  /** 해당 survey 의 총 question 수 (notice 포함). in_progress 일 때 사용 */
  totalSteps?: number
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
      const n = args.currentStepOrder ?? null
      const m = args.totalSteps ?? null
      const q = args.qNumber ?? null
      const nStr = n === null ? '?' : String(n)
      const mStr = m === null ? '?' : String(m)
      const qStr = q === null ? '?' : q
      return { label: '진행중', tone: 'blue', sub: `${nStr}/${mStr} · ${qStr}` }
    }
    default:
      return { label: '기타', tone: 'gray' }
  }
}
