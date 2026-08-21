import { computeTableEstimatedHeight } from '@/components/question-renderer/hooks/use-row-heights';
import { isEmptyHtml } from '@/lib/utils';
import { Question } from '@/types/survey';

export const noop = () => {};

// ── 카드 높이 추정 상수 (CSS와 동기화) ──

// 공통
export const DESC_ESTIMATE = 60;
export const INPUT_H = 40;
export const TEXTAREA_H = 84;
export const OPT_ROW = 28;
export const ML_LEVEL = 70;

// 테스트 모드 (QuestionTestCard): p-6, border-l-4
export const TEST_SHELL = 48 + 32 + 28 + 12; // padding + header + title + gap

// 편집 모드 (SortableQuestion): p-6, 드래그 핸들 헤더, bg-gray-50 preview wrapper
export const EDIT_SHELL = 48 + 52 + 28 + 12 + 24; // padding + header(drag+buttons) + title + gap + preview wrapper(p-3×2)

export function estimateInputHeight(question: Question): number {
  switch (question.type) {
    case 'text':
    case 'select':
      return INPUT_H;
    case 'textarea':
      return TEXTAREA_H;
    case 'radio':
    case 'checkbox': {
      const n = (question.options?.length ?? 0) + (question.allowOtherOption ? 1 : 0);
      return n * OPT_ROW + 8;
    }
    case 'multiselect':
      return (question.selectLevels?.length ?? 1) * ML_LEVEL;
    case 'ranking': {
      const positions = Math.max(1, question.rankingConfig?.positions ?? 3);
      return positions * (INPUT_H + 8);
    }
    case 'table':
      return computeTableEstimatedHeight(
        question.tableColumns ?? [],
        question.tableRowsData ?? [],
        question.tableHeaderGrid ?? undefined,
      );
    case 'notice':
      return 80 + (question.requiresAcknowledgment ? 52 : 0);
    default:
      return INPUT_H;
  }
}

export function estimateCardHeight(question: Question, mode: 'edit' | 'test'): number {
  const shell = mode === 'test' ? TEST_SHELL : EDIT_SHELL;
  let h = shell + estimateInputHeight(question);
  if (question.description && !isEmptyHtml(question.description)) {
    h += DESC_ESTIMATE + 16;
  }
  return h;
}

export function getQuestionTypeLabel(type: string): string {
  const labels = {
    notice: '공지사항',
    text: '단답형',
    textarea: '장문형',
    radio: '단일선택',
    checkbox: '다중선택',
    select: '드롭다운',
    multiselect: '다단계선택',
    ranking: '순위형',
    table: '테이블',
  };
  return labels[type as keyof typeof labels] || type;
}
