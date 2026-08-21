import { OPTION_TEXT_TARGET_ATTRIBUTE } from '@/lib/survey/option-text-target';
import type { TableRow } from '@/types/survey';

function findDataTarget(attribute: string, ids: readonly string[]): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(`[${attribute}]`);
  for (const id of ids) {
    const match = [...candidates].find((candidate) => candidate.getAttribute(attribute) === id);
    if (match) return match;
  }
  return null;
}

export interface IssueScrollTargets {
  detailTargetIds?: readonly string[] | undefined;
  cellInstanceIds?: readonly string[] | undefined;
  cellIds?: readonly string[] | undefined;
  questionId?: string | undefined;
}

export function buildRowWiseCellInstanceIds(
  rows: readonly TableRow[] | undefined,
  cellIds: readonly string[] | undefined,
): string[] {
  if (!rows || !cellIds?.length) return [];
  const requested = new Set(cellIds);
  const instances: string[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!requested.has(cell.id)) continue;
      instances.push(`${row.id}:${row.id}:${cell.id}`);
      requested.delete(cell.id);
    }
    if (requested.size === 0) break;
  }
  return instances;
}

const FOCUSABLE_SELECTOR = [
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * 실제 상세 입력 → 표 셀 → 질문 카드 순으로 첫 렌더 타깃을 찾아 이동한다.
 * attribute 값을 직접 비교해 UUID 외 임의 문자열도 CSS escape 없이 안전하게 처리한다.
 */
export function scrollToIssue({
  detailTargetIds = [],
  cellInstanceIds = [],
  cellIds = [],
  questionId,
}: IssueScrollTargets): void {
  const detail = findDataTarget(OPTION_TEXT_TARGET_ATTRIBUTE, detailTargetIds);
  const cellInstance = detail
    ? null
    : findDataTarget('data-cell-instance-id', cellInstanceIds);
  const cell = detail || cellInstance ? null : findDataTarget('data-cell-id', cellIds);
  const question =
    detail || cellInstance || cell || !questionId
      ? null
      : findDataTarget('data-question-id', [questionId]);
  const target = detail ?? cellInstance ?? cell ?? question;
  if (!target) return;
  const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
  target.scrollIntoView({ behavior, block: 'center' });
  const focusTarget = target.matches(FOCUSABLE_SELECTOR)
    ? target
    : target.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  focusTarget?.focus({ preventScroll: true });
}

/** 기존 표 전용 호출부 하위 호환. */
export function scrollToCell(cellIds: readonly string[]): void {
  scrollToIssue({ cellIds });
}
