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
import { OPT_TEXTS_KEY } from '@/lib/survey/response-sidecars';

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

/**
 * 단답형·표 셀의 이월 원본 값(문자열만). 없거나 문자열이 아니면 null.
 *
 * 입력 형식 검사의 면제 판정에 쓴다 — 응답자가 치지도 않은 지난 회차 값 때문에
 * "다음"이 막히면 따를 수 있는 길이 없다. 비교는 **글자 그대로**다. 한 글자라도
 * 고치면 그때부터 검사 대상이 된다.
 */
export function priorAnswerText(
  prior: PriorAnswers | null | undefined,
  questionId: string,
  cellId?: string,
): string | null {
  if (!prior || isSidecarKey(questionId)) return null;
  const value = prior[questionId];
  if (cellId === undefined) return typeof value === 'string' ? value : null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cell = (value as Record<string, unknown>)[cellId];
  return typeof cell === 'string' ? cell : null;
}

/**
 * 보기 상세기재(`__optTexts__` 사이드카)의 이월 원본 값. 보기-소스 표의 입력 셀도
 * 같은 자리에 셀 id 로 들어 있어 한 함수가 둘을 덮는다.
 */
export function priorOptionText(
  prior: PriorAnswers | null | undefined,
  questionId: string,
  optionId: string,
): string | null {
  if (!prior) return null;
  const sidecar = prior[OPT_TEXTS_KEY];
  if (!sidecar || typeof sidecar !== 'object') return null;
  const byQuestion = (sidecar as Record<string, unknown>)[questionId];
  if (!byQuestion || typeof byQuestion !== 'object') return null;
  const value = (byQuestion as Record<string, unknown>)[optionId];
  return typeof value === 'string' ? value : null;
}

/**
 * 이 값이 이월 원본과 **글자 그대로** 같은가 — 응답자가 손대지 않았다는 뜻이다.
 *
 * 입력 형식 검사와 blur 정돈이 함께 쓰는 단일 판정이다(CONTEXT.md "이월 면제").
 * 화면과 검증이 각자 비교하면 "문구는 안 뜨는데 다음은 막힌다" 같은 어긋남이 난다.
 */
export function isUntouchedPriorValue(value: string, priorOriginal: string | null): boolean {
  return priorOriginal !== null && value === priorOriginal;
}
