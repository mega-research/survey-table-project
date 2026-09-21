import type { QuotaCategory, QuotaDimension } from '@/shared/contracts/quota';
import type { NormalizedQuotaConfig } from './normalize';

/**
 * 쿼터 판정 대상 — 응답값과, 그 응답에 연결된 조사 대상의 attrs.
 * attrs 는 서버가 조사 대상 연결로 읽은 값만 싣는다(클라이언트 입력 금지). 익명 응답은 null.
 */
export interface QuotaSubject {
  answers: Record<string, unknown>;
  attrs: Record<string, string | undefined> | null;
}

/** 조사 대상 attrs 를 읽어야 분류되는 플랜인가 — 모수 로더가 조인 여부를 정한다. */
export function needsContactAttrs(config: NormalizedQuotaConfig): boolean {
  return config.dimensions.some((d) => d.kind === 'attr');
}

/**
 * 저장된 답을 매칭용 문자열 후보 배열로 정규화.
 * radio/select는 문자열, other-option은 {selectedValue}/{optionId} 래퍼,
 * checkbox는 배열. 숫자는 문자열화. null/undefined는 빈 배열.
 */
export function normalizeAnswerValues(answer: unknown): string[] {
  if (answer == null) return [];
  if (typeof answer === 'string') return [answer];
  if (typeof answer === 'number') return [String(answer)];
  if (Array.isArray(answer)) return answer.flatMap(normalizeAnswerValues);
  if (typeof answer === 'object') {
    const obj = answer as Record<string, unknown>;
    if (typeof obj['selectedValue'] === 'string') return [obj['selectedValue']];
    if (typeof obj['optionId'] === 'string') return [obj['optionId']];
  }
  return [];
}

function matchesNumeric(category: QuotaCategory, answer: unknown): boolean {
  const raw = normalizeAnswerValues(answer)[0];
  if (raw === undefined) return false;
  if (raw.trim() === '') return false; // 빈/공백 문자열은 미응답 — Number('')=0 오분류 방지
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  const min = category.min ?? null;
  const max = category.max ?? null;
  if (min !== null && n < min) return false;
  if (max !== null && n >= max) return false; // 반열림 min ≤ n < max
  return true;
}

function matchesChoice(category: QuotaCategory, answer: unknown): boolean {
  const values = category.values ?? [];
  if (!values.length) return false;
  const answered = normalizeAnswerValues(answer);
  return answered.some((v) => values.includes(v));
}

function matchesAttr(category: QuotaCategory, raw: string | undefined): boolean {
  const value = raw?.trim() ?? '';
  if (value === '') return false;
  return (category.values ?? []).some((v) => v.trim() === value);
}

/** 텍스트 비교용 정돈 — 모든 공백 제거 + 영문 소문자화. */
function foldText(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/**
 * 텍스트형 차원의 대상 칸 값들(정돈 후, 빈 칸 제외).
 * 표 문항이면 cellIds 의 칸만, 단답형이면 응답 문자열 하나. 칸은 이어 붙이지 않는다 —
 * 「화성 / 남양읍」이 칸 경계를 가로질러 "성남"에 걸리면 안 된다.
 */
function textTargets(dimension: QuotaDimension, answer: unknown): string[] {
  const cellIds = dimension.cellIds ?? [];
  let raws: unknown[];
  if (cellIds.length === 0) {
    raws = [answer];
  } else if (answer !== null && typeof answer === 'object' && !Array.isArray(answer)) {
    const cells = answer as Record<string, unknown>;
    raws = cellIds.map((id) => cells[id]);
  } else {
    raws = [];
  }
  return raws
    .map((raw) => (typeof raw === 'string' || typeof raw === 'number' ? foldText(String(raw)) : ''))
    .filter((text) => text !== '');
}

function resolveTextCategoryId(dimension: QuotaDimension, answer: unknown): string | null {
  const targets = textTargets(dimension, answer);
  if (targets.length === 0) return null; // 값이 없으면 「그 외」도 받지 않는다 — 미분류
  let elseId: string | null = null;
  for (const category of dimension.categories) {
    if (category.isElse) {
      elseId ??= category.id;
      continue;
    }
    const keywords = (category.keywords ?? []).map(foldText).filter((k) => k !== '');
    if (keywords.some((k) => targets.some((t) => t.includes(k)))) return category.id;
  }
  // 「그 외」는 놓인 자리와 무관하게 키워드 카테고리가 전부 빗나간 뒤에만 받는다.
  return elseId;
}

/** 한 차원에서 응답이 속하는 카테고리 id. 미매칭이면 null. (옵션형·숫자형) */
export function resolveCategoryId(dimension: QuotaDimension, answer: unknown): string | null {
  for (const category of dimension.categories) {
    const matched =
      dimension.kind === 'numeric' ? matchesNumeric(category, answer) : matchesChoice(category, answer);
    if (matched) return category.id;
  }
  return null;
}

/** 한 차원에서 판정 대상이 속하는 카테고리 id — 네 유형 공용 입구. 미매칭이면 null. */
export function resolveSubjectCategoryId(
  dimension: QuotaDimension,
  subject: QuotaSubject,
): string | null {
  if (dimension.kind === 'attr') {
    const raw = dimension.attrKey ? subject.attrs?.[dimension.attrKey] : undefined;
    return dimension.categories.find((c) => matchesAttr(c, raw))?.id ?? null;
  }
  const answer = subject.answers[dimension.questionId];
  if (dimension.kind === 'text') return resolveTextCategoryId(dimension, answer);
  return resolveCategoryId(dimension, answer);
}

/** 모든 차원의 카테고리 id를 차원 순서대로. 어느 하나라도 미매칭이면 null(미분류). */
export function deriveCategoryIds(
  config: NormalizedQuotaConfig,
  subject: QuotaSubject,
): string[] | null {
  const ids: string[] = [];
  for (const dimension of config.dimensions) {
    const categoryId = resolveSubjectCategoryId(dimension, subject);
    if (categoryId === null) return null;
    ids.push(categoryId);
  }
  return ids;
}

/** 셀 키 — categoryId를 구분자로 이은 문자열. 순서 유의. */
export function cellKeyOf(categoryIds: string[]): string {
  return categoryIds.join('');
}

/** 셀의 목표. 미등록(sparse)이면 null. */
export function findTarget(config: NormalizedQuotaConfig, categoryIds: string[]): number | null {
  const key = cellKeyOf(categoryIds);
  for (const cell of config.cells) {
    if (cellKeyOf(cell.categoryIds) === key) return cell.target;
  }
  return null;
}

/** 완료 응답(판정 대상) 목록에서 특정 셀에 속하는 수. */
export function countCell(
  config: NormalizedQuotaConfig,
  categoryIds: string[],
  subjects: QuotaSubject[],
): number {
  const key = cellKeyOf(categoryIds);
  let count = 0;
  for (const subject of subjects) {
    const derived = deriveCategoryIds(config, subject);
    if (derived && cellKeyOf(derived) === key) count += 1;
  }
  return count;
}

/** 모든 셀의 현재 수 맵 (cellKey → count). 미분류 응답은 제외. */
export function tallyAll(
  config: NormalizedQuotaConfig,
  subjects: QuotaSubject[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const subject of subjects) {
    const derived = deriveCategoryIds(config, subject);
    if (!derived) continue;
    const key = cellKeyOf(derived);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}
