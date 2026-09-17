import { OPTION_TEXT_TARGET_ATTRIBUTE } from '@/features/question-renderer/utils/option-text-target';
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

/** 검증 안내(CONTEXT.md) 요소의 표식 — 값은 그 안내가 속한 문항 id */
export const VALIDATION_NOTICE_ATTRIBUTE = 'data-validation-notice';

/**
 * 「다음」이 막혔을 때의 착지 — 그 문항의 검증 안내로 간다. 위반 셀이나 문항 카드로 뛰어들지
 * 않는다: 표 문항은 카드 가운데가 표 한복판이라 어디가 문제인지 보이지 않았고, 셀 이동은
 * 안내의 「위치로 이동」이 맡는다(2026-09-15 결정). 화면 가운데에 세우고 첫 이동 버튼에
 * 포커스를 둔다 — 버튼 없는 한 줄 안내는 포커스를 옮기지 않는다. 안내가 아직 없으면 문항 카드.
 */
export function scrollToValidationNotice(questionId: string): void {
  const notice = findDataTarget(VALIDATION_NOTICE_ATTRIBUTE, [questionId]);
  if (!notice) {
    scrollToIssue({ questionId });
    return;
  }
  const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
  notice.scrollIntoView({ behavior, block: 'center' });
  notice.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
}
