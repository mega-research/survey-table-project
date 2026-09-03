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
  return supportsChangeConfirmation(question) && hasPriorAnswer(prior, question.id);
}

/**
 * 이 문항 **유형**이 변동 확인을 받을 수 있는가 — 이월 값 보유 여부와 무관한 절반이다.
 *
 * 이월 값을 손에 쥐지 않은 자리(내보내기 변수 생성)가 같은 규칙을 쓰기 위해 분리했다.
 * 규칙이 갈라지면 응답 화면에는 컨트롤이 없는데 내보내기에만 변수가 생긴다.
 */
export function supportsChangeConfirmation(question: Question): boolean {
  // 안내문은 답 자체가 없는 유형이다.
  if (question.type === 'notice') return false;
  // 본문 프리필 템플릿이 걸린 문항은 이월 요약 채널이다 — 이월 응답이 있어도 템플릿 값이
  // 이기므로(CONTEXT.md > 이월 값과 본문 프리필 토큰의 우선순위) 물을 것이 없다.
  if (question.defaultValueTemplate?.trim()) return false;
  return true;
}

/**
 * 아직 변동 여부를 밝히지 않아 응답자가 손댈 수 없는 상태인가.
 *
 * `isPriorAnswerLocked` 와 다르다 — "같음"으로 잠긴 문항은 이미 답이 확정됐으므로
 * 대기 상태가 아니다. 필수·숫자 검증은 이 대기 상태의 문항을 건너뛰어야 한다:
 * 잠긴 입력을 두고 "답변해주세요"라고 하는 것은 응답자가 따를 수 없는 요구다.
 */
export function isAwaitingChangeConfirmation(
  question: Question,
  prior: PriorAnswers | null | undefined,
  responses: Record<string, unknown> | null | undefined,
): boolean {
  if (!requiresChangeConfirmation(question, prior)) return false;
  return getChangeConfirmation(responses, question.id) === null;
}

/**
 * 변동 확인을 밝혔을 때 이번 회차 응답에 써야 할 값.
 *
 * - "같음": 언제나 이월 값을 다시 복사한다. 그 선택 자체가 "지난 회차 값이 올해도 내 답"
 *   이라는 진술이고, 되돌리기(달라짐 → 같음)에서 값이 어긋나지 않게 하는 것도 이 규칙이다.
 * - "달라짐": 채워진 채로 열려야 바뀐 칸만 고칠 수 있으므로 값이 아직 없을 때만 채운다.
 *   이미 고친 값이 있으면 덮지 않는다.
 */
export function resolveAnswerOnConfirmation(
  question: Question,
  prior: PriorAnswers | null | undefined,
  responses: Record<string, unknown> | null | undefined,
  confirmation: ChangeConfirmation,
): { write: true; value: unknown } | { write: false } {
  if (!requiresChangeConfirmation(question, prior)) return { write: false };
  if (confirmation === 'changed' && responses?.[question.id] !== undefined) {
    return { write: false };
  }
  return { write: true, value: prior?.[question.id] };
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

/**
 * 이 문항의 입력이 잠겨 있는가.
 *
 * 이월 값이 있는 문항의 기본 상태는 잠금이다. "달라짐"을 골라야 열린다 — "같음"은
 * 더 손댈 것이 없다는 진술이라 고른 뒤에도 잠긴 채로 지나간다.
 * 이월 값이 없는 문항과 익명 응답자에게는 처음부터 잠금이 없다.
 */
export function isPriorAnswerLocked(
  question: Question,
  prior: PriorAnswers | null | undefined,
  responses: Record<string, unknown> | null | undefined,
): boolean {
  if (!requiresChangeConfirmation(question, prior)) return false;
  return getChangeConfirmation(responses, question.id) !== 'changed';
}

/** 키 순서에 흔들리지 않는 값 비교용 직렬화. 응답값은 JSON 안전한 형태만 담긴다. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(',')}}`;
}

/**
 * "달라짐"이라고 밝혔는데 값이 이월 값과 완전히 같은 문항 id 를 낸다.
 *
 * 제출 시 한 번 되묻기 위한 목록이며 **차단 근거가 아니다** — 아홉 칸 중 여덟 칸이
 * 지난 회차와 같은 것은 정상이고, 진짜로 한 칸도 안 바뀐 것도 있을 수 있다.
 */
export function collectUnmodifiedChangedQuestionIds(
  questions: readonly Question[],
  prior: PriorAnswers | null | undefined,
  responses: Record<string, unknown> | null | undefined,
): string[] {
  if (!prior) return [];
  const confirmations = readChangeConfirmations(responses);
  const current = responses ?? {};
  return questions
    .filter(
      (question) =>
        requiresChangeConfirmation(question, prior) &&
        confirmations[question.id] === 'changed' &&
        stableStringify(current[question.id]) === stableStringify(prior[question.id]),
    )
    .map((question) => question.id);
}
