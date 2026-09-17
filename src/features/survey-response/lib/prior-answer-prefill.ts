/**
 * 이월 값 프리필 판정 — CONTEXT.md > 추적조사 참조.
 *
 * 문항별 변동 확인이 **꺼진** 설문에서 이월 값이 이번 회차 응답으로 넘어가는 경로다.
 * 켜진 설문은 이 모듈을 쓰지 않는다 — 그쪽은 응답자가 변동 여부를 밝히는 순간
 * 문항 단위로 복사한다(`resolveAnswerOnConfirmation`).
 *
 * **표시되는 문항에만 깐다.** 숨은 문항까지 깔아도 헛일이다 — 저장 경계의
 * `stripHiddenQuestionValues`(`lib/survey/question-visibility.ts`)가 곧바로 지운다.
 * 그리고 앞 문항에서 "해당 없음"을 고른 사람에게 지난 회차 하위 답이 화면에 잠시라도
 * 실려 나가는 것은 여전히 막아야 한다. 호출부가 그 단계의 표시 가능 문항만 넘긴다
 * (`collectUnconfirmedQuestionIds` 와 같은 계약).
 *
 * **이미 값이 있으면 덮지 않는다.** 응답자가 고친 값이 프리필에 밀리면 안 되고,
 * 재진입 복원으로 되살아난 값도 마찬가지다.
 */
import { supportsChangeConfirmation } from '@/lib/survey/change-confirmation';
import { shouldLoadPriorAnswer } from '@/lib/survey/prior-answer-condition';
import { type PriorAnswers, hasPriorAnswer } from '@/lib/survey/prior-answers';
import type { Question } from '@/types/survey';
import type { BranchEvalCtx } from '@/utils/branch-eval';

/** 프리필로 써야 할 문항 하나. */
export interface PriorAnswerPrefillEntry {
  questionId: string;
  value: unknown;
}

/**
 * 이 단계에서 이월 값으로 채울 문항을 문항 순서대로 낸다.
 *
 * 대상 판정은 변동 확인이 켜진 경로와 **같은 술어**를 쓴다 — 안내문처럼 답이 없는 유형과
 * 본문 프리필 템플릿이 걸린 문항(이월 요약 채널이라 템플릿 값이 이긴다)은 양쪽 다 제외다.
 * 술어가 갈라지면 스위치를 켰다 껐다 할 때 채워지는 문항 집합이 달라진다.
 *
 * @param questions **이미 표시 조건으로 걸러진** 문항 목록
 * @param prior 이월 응답 한 벌. 없으면 빈 배열
 * @param responses 현재 응답 묶음. 값이 이미 있는 문항은 건너뛴다
 * @param allQuestions 이월값 불러오기 조건 평가용 전체 문항. 조건이 참조하는 문항은 이
 *   단계 밖에 있을 수 있어 `questions`(이 단계의 표시 문항)와 별도로 받는다
 */
export function collectPriorAnswerPrefills(
  questions: readonly Question[],
  prior: PriorAnswers | null | undefined,
  responses: Record<string, unknown>,
  allQuestions: readonly Question[] = questions,
  evalCtx?: BranchEvalCtx,
): PriorAnswerPrefillEntry[] {
  if (!prior) return [];
  const entries: PriorAnswerPrefillEntry[] = [];
  for (const question of questions) {
    if (!supportsChangeConfirmation(question)) continue;
    // 문항 단위 이월값 조건 — 표시 조건과 별개 축이다. 이직처럼 같은 문항 안에서
    // 갈리는 경우는 "보이되 안 채운다" 가 필요하고, 표시 조건으로는 표현할 수 없다.
    if (!shouldLoadPriorAnswer(question, responses, allQuestions, evalCtx)) continue;
    // 빈 값은 이월 값이 아니다 — 키만 있고 답이 없는 문항까지 채우면 응답자가 손대지
    // 않은 빈칸이 "지난 회차 답"으로 제출된다.
    if (!hasPriorAnswer(prior, question.id)) continue;
    if (responses[question.id] !== undefined) continue;
    entries.push({ questionId: question.id, value: prior[question.id] });
  }
  return entries;
}

/**
 * 조건이 거짓으로 뒤집혀 걷어내야 할 문항 id 를 낸다.
 *
 * **이 세션에서 실제로 프리필한 문항만 회수한다.** 고쳤든 안 고쳤든 회수하지만, 깔지
 * 않은 값은 절대 건드리지 않는다.
 *
 * 처음에는 "값이 이월값과 같으면 재진입 폴백으로 회수" 를 함께 걸었다가 실사 중에
 * 걷어냈다(2026-09-08). 그 폴백은 프리필로 깔린 값과 **응답자가 우연히 작년과 같은
 * 보기를 고른 것** 을 구분하지 못한다. 조건이 늘 거짓인 문항(담당자가 이월을 막으려고
 * 도달 불가능한 조건을 걸어 두는 실제 운용 방식)에서는 프리필이 한 번도 없었는데도,
 * 작년과 같은 답을 고르는 순간 매 렌더 지워져 라디오가 눌리지 않는 것처럼 보였다 —
 * DQ7 매출액에서 실제로 그렇게 응답이 막혔다. 상태 기준 판정은 응답자의 입력과 싸운다.
 *
 * 대가는 세션 경계다. 이전 세션에서 깔린 값이 남은 채 새 세션에서 조건이 거짓이면 그
 * 값은 살아남는다. 응답을 못 하게 막는 것보다 그쪽이 낫다.
 *
 * @param questions 조건 평가 대상 문항 목록 (표시 조건과 무관 — 숨은 문항도 회수 대상)
 * @param prior 이월 응답 한 벌. 없으면 회수할 것도 없다
 * @param responses 현재 응답 묶음
 * @param allQuestions 이월값 불러오기 조건 평가용 전체 문항
 * @param prefilled 이 세션에서 실제로 프리필한 문항 id 집합
 */
export function collectPriorAnswerRetractions(
  questions: readonly Question[],
  prior: PriorAnswers | null | undefined,
  responses: Record<string, unknown>,
  allQuestions: readonly Question[],
  prefilled: ReadonlySet<string>,
  evalCtx?: BranchEvalCtx,
): string[] {
  if (!prior) return [];
  const retractions: string[] = [];
  for (const question of questions) {
    // 「이월값 불러오기」를 끈 문항은 프리필한 적이 없으니 회수할 것도 없다.
    if (question.priorAnswerDisabled === true) continue;
    if (!question.priorAnswerCondition) continue;
    if (shouldLoadPriorAnswer(question, responses, allQuestions, evalCtx)) continue;
    if (!hasPriorAnswer(prior, question.id)) continue;
    if (!prefilled.has(question.id)) continue;
    if (responses[question.id] === undefined) continue;
    retractions.push(question.id);
  }
  return retractions;
}
