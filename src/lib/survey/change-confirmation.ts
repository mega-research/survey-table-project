/**
 * 변동 확인(change confirmation) 판정 — CONTEXT.md > 추적조사 참조.
 *
 * 추적조사에서 이월 값이 채워진 문항은 응답자가 "지난 회차와 같음 / 달라짐"을
 * 밝혀야 다음 페이지로 넘어갈 수 있다. 그 확인이 없으면 아무도 들여다보지 않은
 * 지난 회차 값이 올해 응답으로 나가버린다.
 *
 * 이 모듈은 화면과 분리된 순수 판정이다 — 문항·이월값·확인상태·현재값만으로
 * 통과/차단을 낸다. 응답 필수 여부와는 **별개 축**이다: 필수가 아닌 문항도
 * 이월 값이 있으면 변동 확인은 요구된다.
 *
 * 확인 상태는 응답 저장 형태 안의 루트 사이드카(`__changeConfirm__`)에 담긴다.
 * 답과 같은 자리에 실려 다니므로 재진입 복원이 별도 처리 없이 되살린다.
 */

import { hasPriorAnswer, type PriorAnswers } from '@/lib/survey/prior-answers';
import type { Question } from '@/types/survey';

/** 변동 확인 사이드카 키. 질문 id 가 아닌 예약 키라 `__` 접두 관례를 따른다. */
export const CHANGE_CONFIRM_KEY = '__changeConfirm__';

export const CHANGE_CONFIRM_VALUES = ['same', 'changed'] as const;

/** `same` = 지난 회차와 같음, `changed` = 달라짐. */
export type ChangeConfirmation = (typeof CHANGE_CONFIRM_VALUES)[number];

/** 질문 id → 변동 확인 상태. */
export type ChangeConfirmations = Record<string, ChangeConfirmation>;

function isChangeConfirmation(value: unknown): value is ChangeConfirmation {
  return (CHANGE_CONFIRM_VALUES as readonly unknown[]).includes(value);
}

/**
 * 사이드카 원본을 읽기 경계에서 정규화한다 (JSONB 드리프트 관례).
 *
 * `isKnownQuestionId` 를 주면 실존 문항의 확인만 남긴다 — 서버 저장 경계가
 * 설문에 없는 키를 걸러내는 용도다. 주지 않으면 값 형태만 검사한다.
 */
export function sanitizeChangeConfirmations(
  raw: unknown,
  isKnownQuestionId?: (questionId: string) => boolean,
): ChangeConfirmations {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: ChangeConfirmations = {};
  for (const [questionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isChangeConfirmation(value)) continue;
    if (isKnownQuestionId && !isKnownQuestionId(questionId)) continue;
    result[questionId] = value;
  }
  return result;
}

/** 응답 묶음에서 변동 확인 사이드카를 꺼낸다. */
export function readChangeConfirmations(
  responses: Record<string, unknown> | null | undefined,
): ChangeConfirmations {
  if (!responses) return {};
  return sanitizeChangeConfirmations(responses[CHANGE_CONFIRM_KEY]);
}

/** 이 문항의 변동 확인 상태. 아직 밝히지 않았으면 null. */
export function getChangeConfirmation(
  responses: Record<string, unknown> | null | undefined,
  questionId: string,
): ChangeConfirmation | null {
  return readChangeConfirmations(responses)[questionId] ?? null;
}

/**
 * 사이드카에 이 문항의 확인을 반영한 새 사이드카를 만든다. 원본은 변형하지 않는다.
 * 한 번 밝힌 확인을 "미선택"으로 되돌리는 경로는 없다 — 컨트롤은 두 값 중 하나만 낸다.
 */
export function updateChangeConfirmations(
  currentSidecar: unknown,
  questionId: string,
  value: ChangeConfirmation,
): ChangeConfirmations {
  return { ...sanitizeChangeConfirmations(currentSidecar), [questionId]: value };
}

/**
 * 이 문항에 변동 확인 컨트롤이 붙는가.
 *
 * 이월 값이 있는 문항에만 붙는다 — 신규 문항·지난 회차에 답이 없던 문항·익명
 * 응답자에게는 비교 대상이 없어 물을 것이 없다. 안내문은 답 자체가 없는 유형이라
 * 이월 값이 실려 오더라도 제외한다.
 */
export function requiresChangeConfirmation(
  question: Question,
  prior: PriorAnswers | null | undefined,
): boolean {
  if (question.type === 'notice') return false;
  return hasPriorAnswer(prior, question.id);
}

/**
 * 아직 변동 확인을 밝히지 않은 문항 id 를 문항 순서대로 낸다.
 *
 * `questions` 는 **이미 표시 조건으로 걸러진 문항 목록**이어야 한다 — 숨겨진
 * 문항은 응답자에게 보이지 않으므로 확인을 요구하지 않는다(호출부가 스텝의
 * 표시 가능 문항을 넘긴다).
 */
export function collectUnconfirmedQuestionIds(
  questions: readonly Question[],
  prior: PriorAnswers | null | undefined,
  responses: Record<string, unknown> | null | undefined,
): string[] {
  if (!prior) return [];
  const confirmations = readChangeConfirmations(responses);
  return questions
    .filter((question) => requiresChangeConfirmation(question, prior) && !confirmations[question.id])
    .map((question) => question.id);
}
