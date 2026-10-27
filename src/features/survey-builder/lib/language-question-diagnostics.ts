/**
 * 언어 문항 빌더 경고 (CONTEXT.md 「언어 문항」) — 배포를 막지 않고 질문 편집 모달이 알린다.
 *
 * 응답 화면은 조용히 맨 앞 언어 문항만 쓰고, 언어 페이지 자동 넘김도 첫 페이지를 전제한다.
 * 설정이 어긋났다는 신호는 여기서만 난다.
 */
import type { Question, QuestionGroup } from '@/types/survey';
import { buildRenderSteps } from '@/utils/group-ordering';
import { findLanguageQuestion, isLanguageQuestion } from '@/utils/survey-language';

export type LanguageQuestionWarning =
  /** 앞에 다른 언어 문항이 있어 이 문항은 언어를 정하지 않는다 */
  | 'not-primary'
  /** 언어 문항이 첫 페이지에 없다 — 언어를 고르기 전 페이지가 한국어 시스템 글자로 나간다 */
  | 'not-first-page';

export const LANGUAGE_QUESTION_WARNING_MESSAGES: Record<LanguageQuestionWarning, string> = {
  'not-primary':
    '앞에 다른 언어 문항이 있어 이 문항의 언어는 쓰이지 않습니다. 언어 문항은 설문에 하나만 두세요.',
  'not-first-page':
    '언어 문항이 첫 페이지에 있지 않습니다. 언어를 고르기 전에 나오는 페이지는 언어가 정해지지 않은 채 보입니다.',
};

export function diagnoseLanguageQuestion(input: {
  /** 진단할 문항 */
  questionId: string;
  /** 설문의 문항 목록 — 편집 중인 문항은 폼 값을 반영한 상태로 넘긴다 */
  questions: Question[];
  groups: QuestionGroup[];
}): LanguageQuestionWarning[] {
  const self = input.questions.find((q) => q.id === input.questionId);
  if (!self || !isLanguageQuestion(self)) return [];

  const primary = findLanguageQuestion(input.questions, input.groups);
  if (primary && primary.id !== self.id) return ['not-primary'];

  const firstPage = buildRenderSteps(input.questions, input.groups)[0];
  const onFirstPage = firstPage?.items.some((item) => item.question.id === self.id) ?? false;
  return onFirstPage ? [] : ['not-first-page'];
}
