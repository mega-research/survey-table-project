import type { QuotaCategory, QuotaConfig, QuotaDimension } from '@/db/schema/schema-types';

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

/** 한 차원에서 응답이 속하는 카테고리 id. 미매칭이면 null. */
export function resolveCategoryId(dimension: QuotaDimension, answer: unknown): string | null {
  for (const category of dimension.categories) {
    const matched =
      dimension.kind === 'numeric' ? matchesNumeric(category, answer) : matchesChoice(category, answer);
    if (matched) return category.id;
  }
  return null;
}

/** 모든 차원의 카테고리 id를 차원 순서대로. 어느 하나라도 미매칭이면 null(미분류). */
export function deriveCategoryIds(
  config: QuotaConfig,
  answers: Record<string, unknown>,
): string[] | null {
  const ids: string[] = [];
  for (const dimension of config.dimensions) {
    const categoryId = resolveCategoryId(dimension, answers[dimension.questionId]);
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
export function findTarget(config: QuotaConfig, categoryIds: string[]): number | null {
  const key = cellKeyOf(categoryIds);
  for (const cell of config.cells) {
    if (cellKeyOf(cell.categoryIds) === key) return cell.target;
  }
  return null;
}

/** 완료 응답 answers 목록에서 특정 셀에 속하는 수. */
export function countCell(
  config: QuotaConfig,
  categoryIds: string[],
  answersList: Record<string, unknown>[],
): number {
  const key = cellKeyOf(categoryIds);
  let count = 0;
  for (const answers of answersList) {
    const derived = deriveCategoryIds(config, answers);
    if (derived && cellKeyOf(derived) === key) count += 1;
  }
  return count;
}

/** 모든 셀의 현재 수 맵 (cellKey → count). 미분류 응답은 제외. */
export function tallyAll(
  config: QuotaConfig,
  answersList: Record<string, unknown>[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const answers of answersList) {
    const derived = deriveCategoryIds(config, answers);
    if (!derived) continue;
    const key = cellKeyOf(derived);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}
