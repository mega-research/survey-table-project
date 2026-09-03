/**
 * 이월 응답(prior answers) 공용 로직 — CONTEXT.md > 추적조사 참조.
 *
 * 이월 응답은 조사 대상 한 명이 지난 회차에 문항에 답한 내용 한 벌이며,
 * 저장 형태가 이번 회차 응답(`survey_responses.questionResponses`)과 동형이다.
 * 그 동형성 덕분에 값이 별도 변환 없이 이번 회차 응답으로 복사된다.
 *
 * 이월 값은 응답값에 미리 깔리지 않는다 — 잠긴 입력의 표시값으로만 쓰이고, 응답자가
 * 변동 확인을 밝히는 순간 문항 단위로 복사된다(CONTEXT.md > 추적조사 > 이월 값의 자리).
 *
 * 이월 요약(조사 대상 attrs)과는 다른 것이다 — 본문 토큰 치환·표시 조건은
 * 이월 요약을 쓰고, 이월 응답은 값 표시·복사에만 쓴다.
 */

/** 이월 응답 한 벌. 질문 id → 값. 사이드카 키(`__` 접두)도 함께 들어온다. */
export type PriorAnswers = Record<string, unknown>;

/** 회차 라벨 미설정 시 응답 화면 문구에 쓰는 기본값. */
export const DEFAULT_PRIOR_WAVE_LABEL = '지난 회차';

/**
 * 사이드카 키 판정 — 코드베이스 관례상 `__` 접두 키는 질문 답이 아니라 예약 사이드카다
 * (structural-survival 과 동일 규칙).
 */
function isSidecarKey(key: string): boolean {
  return key.startsWith('__');
}

/** 저장값이 "답이 있다"고 볼 수 있는 값인가. 빈 문자열·빈 배열·빈 객체는 미응답. */
function isNonEmptyAnswerValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.some(isNonEmptyAnswerValue);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, entry]) => !isSidecarKey(key) && isNonEmptyAnswerValue(entry),
    );
  }
  return true;
}

/**
 * JSONB 로 들어온 이월 응답을 읽기 경계에서 정규화한다 (JSONB 드리프트 관례).
 * 객체가 아니면 빈 묶음으로 수렴시켜 호출부가 `?.` 를 덧대지 않게 한다.
 */
export function normalizePriorAnswers(raw: unknown): PriorAnswers {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

/**
 * 이 문항에 이월 값이 있는가. 변동 확인 컨트롤 노출 조건이자 잠금 표시값의 조건이다.
 * 사이드카 키는 문항이 아니므로 항상 false.
 */
export function hasPriorAnswer(
  prior: PriorAnswers | null | undefined,
  questionId: string,
): boolean {
  if (!prior || isSidecarKey(questionId)) return false;
  if (!Object.prototype.hasOwnProperty.call(prior, questionId)) return false;
  return isNonEmptyAnswerValue(prior[questionId]);
}

/** 응답 화면 문구에 쓸 회차 라벨. 설문 설정이 비어 있으면 기본 문구. */
export function resolvePriorWaveLabel(label: string | null | undefined): string {
  const trimmed = label?.trim();
  return trimmed ? trimmed : DEFAULT_PRIOR_WAVE_LABEL;
}
