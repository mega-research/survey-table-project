import { OPTION_TEXT_TARGET_ATTRIBUTE } from '@/lib/survey/option-text-target';

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
  cellIds?: readonly string[] | undefined;
  questionId?: string | undefined;
}

/**
 * 실제 상세 입력 → 표 셀 → 질문 카드 순으로 첫 렌더 타깃을 찾아 이동한다.
 * attribute 값을 직접 비교해 UUID 외 임의 문자열도 CSS escape 없이 안전하게 처리한다.
 */
export function scrollToIssue({
  detailTargetIds = [],
  cellIds = [],
  questionId,
}: IssueScrollTargets): void {
  const detail = findDataTarget(OPTION_TEXT_TARGET_ATTRIBUTE, detailTargetIds);
  const cell = detail ? null : findDataTarget('data-cell-id', cellIds);
  const question =
    detail || cell || !questionId ? null : findDataTarget('data-question-id', [questionId]);
  const target = detail ?? cell ?? question;
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** 기존 표 전용 호출부 하위 호환. */
export function scrollToCell(cellIds: readonly string[]): void {
  scrollToIssue({ cellIds });
}
