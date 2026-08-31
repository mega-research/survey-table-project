/**
 * 응답 저장 형태의 루트 사이드카 등록부.
 *
 * `questionResponses` 최상위에는 질문 id 말고도 예약 키(`__` 접두)가 함께 실린다.
 * 이 키들은 실존 문항이 아니므로 저장 경계의 소속 검증·멤버십 필터에서 분리해야
 * 한다 — 분리를 빠뜨리면 저장이 통째로 500 이 되거나(saveDraft) 제출 순간 값이
 * 조용히 사라진다(complete). 실제로 `__optTexts__` 가 그 두 사고를 다 겪었다.
 *
 * 새 사이드카를 추가할 때 검증 경로마다 분기를 다시 심지 않도록 여기 한 곳에
 * 키와 정제 함수를 등록한다. 등록되지 않은 `__` 키는 기존대로 거부된다.
 */

import { readOptTextsSidecar } from '@/lib/option-text-read';
import { CHANGE_CONFIRM_KEY, sanitizeChangeConfirmations } from '@/lib/survey/change-confirmation';

export const OPT_TEXTS_KEY = '__optTexts__';

/**
 * 사이드카 정제 함수. 형태 검증을 수행하고, 실존 문항 판정이 주어지면 그 문항의
 * 값만 남긴다. 빈 결과는 호출부가 저장에서 빼도록 `{}` 로 돌아온다.
 */
type SidecarSanitizer = (
  raw: unknown,
  isKnownQuestionId?: (questionId: string) => boolean,
) => Record<string, unknown>;

const SANITIZERS: Record<string, SidecarSanitizer> = {
  [OPT_TEXTS_KEY]: (raw, isKnownQuestionId) => {
    const shaped = readOptTextsSidecar({ [OPT_TEXTS_KEY]: raw });
    if (!isKnownQuestionId) return shaped;
    return Object.fromEntries(
      Object.entries(shaped).filter(([questionId]) => isKnownQuestionId(questionId)),
    );
  },
  [CHANGE_CONFIRM_KEY]: (raw, isKnownQuestionId) =>
    sanitizeChangeConfirmations(raw, isKnownQuestionId),
};

/** 저장이 허용된 루트 사이드카 키인가. */
export function isPersistedRootSidecarKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(SANITIZERS, key);
}

/**
 * 응답 엔트리를 답변과 사이드카로 가른다. 답변 쪽만 소속 검증에 넣는다.
 * 등록되지 않은 `__` 키는 답변 쪽에 남아 기존대로 거부된다.
 */
export function splitRootSidecars(
  entries: readonly (readonly [string, unknown])[],
): {
  answerEntries: [string, unknown][];
  sidecarEntries: [string, unknown][];
} {
  const answerEntries: [string, unknown][] = [];
  const sidecarEntries: [string, unknown][] = [];
  for (const [key, value] of entries) {
    if (isPersistedRootSidecarKey(key)) sidecarEntries.push([key, value]);
    else answerEntries.push([key, value]);
  }
  return { answerEntries, sidecarEntries };
}

/**
 * 사이드카 하나를 저장 형태로 정제한다. 등록되지 않은 키면 null.
 *
 * 빈 결과(`{}`)는 그대로 돌려준다 — "비었으니 저장하지 않는다"는 호출부 정책이지
 * 정제의 판단이 아니다. draft 는 빈 사이드카도 기록해 응답자가 지운 기재가 서버에
 * 반영되게 하고, 완료 저장은 빈 사이드카를 넣지 않는다(기존 동작 유지).
 */
export function sanitizeRootSidecar(
  key: string,
  raw: unknown,
  isKnownQuestionId?: (questionId: string) => boolean,
): Record<string, unknown> | null {
  const sanitize = SANITIZERS[key];
  if (!sanitize) return null;
  return sanitize(raw, isKnownQuestionId);
}
