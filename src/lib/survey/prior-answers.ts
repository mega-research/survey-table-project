/**
 * 이월 응답(prior answers) 공용 로직 — CONTEXT.md > 추적조사 참조.
 *
 * 이월 응답은 조사 대상 한 명이 지난 회차에 문항에 답한 내용 한 벌이며,
 * 저장 형태가 이번 회차 응답(`survey_responses.questionResponses`)과 동형이다.
 * 그 동형성 덕분에 프리필이 관리자 응답 수정과 같은 레일을 그대로 탄다.
 *
 * 이월 요약(조사 대상 attrs)과는 다른 것이다 — 본문 토큰 치환·표시 조건은
 * 이월 요약을 쓰고, 프리필만 이월 응답을 쓴다.
 */

/** 이월 응답 한 벌. 질문 id → 값. 사이드카 키(`__` 접두)도 함께 들어온다. */
export type PriorAnswers = Record<string, unknown>;

/** 기타/상세 기재 사이드카 키 — 응답 저장 형태와 동일. */
const OPT_TEXTS_KEY = '__optTexts__';

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
 * 이 문항에 이월 값이 있는가. 변동 확인 컨트롤 노출 조건이자 프리필 표시 조건이다.
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

/** 기타/상세 기재 사이드카를 문항 단위로 합친다 (이번 회차 문항이 이김). */
function mergeOptTexts(prior: unknown, current: unknown): unknown {
  const priorMap = prior && typeof prior === 'object' && !Array.isArray(prior) ? prior : null;
  const currentMap =
    current && typeof current === 'object' && !Array.isArray(current) ? current : null;
  if (!priorMap) return current;
  if (!currentMap) return prior;
  return { ...(priorMap as Record<string, unknown>), ...(currentMap as Record<string, unknown>) };
}

/**
 * 이월 응답을 바닥에 깔고 이번 회차 응답을 덮는다.
 *
 * 이어가기 회복이 돌려준 저장 답은 응답자가 실제로 남긴 값이므로 항상 이긴다.
 * 이월 값은 아직 손대지 않은 문항에만 남아 프리필로 보인다.
 * 기타/상세 기재 사이드카만 문항 단위로 합쳐, 저장 답이 없는 문항의 이월 기재가
 * 통째 교체로 사라지지 않게 한다.
 */
export function mergeWithPriorAnswers(
  prior: PriorAnswers | null | undefined,
  current: Record<string, unknown>,
): Record<string, unknown> {
  if (!prior || Object.keys(prior).length === 0) return { ...current };
  const merged: Record<string, unknown> = { ...prior, ...current };
  if (OPT_TEXTS_KEY in prior || OPT_TEXTS_KEY in current) {
    const optTexts = mergeOptTexts(prior[OPT_TEXTS_KEY], current[OPT_TEXTS_KEY]);
    if (optTexts === undefined) delete merged[OPT_TEXTS_KEY];
    else merged[OPT_TEXTS_KEY] = optTexts;
  }
  return merged;
}

/** 응답 화면 문구에 쓸 회차 라벨. 설문 설정이 비어 있으면 기본 문구. */
export function resolvePriorWaveLabel(label: string | null | undefined): string {
  const trimmed = label?.trim();
  return trimmed ? trimmed : DEFAULT_PRIOR_WAVE_LABEL;
}
