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
