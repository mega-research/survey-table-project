/**
 * 응답 데이터에서 옵션 텍스트 입력값을 읽는 공용 헬퍼.
 *
 * 저장 구조 (Task 16):
 *   questionResponses.__optTexts__[questionId][optionId]
 *
 * 마이그레이션 호환(레거시):
 *   questionResponses[questionId].optionTexts[optionId]
 *
 * 이 파일은 import 0 인 잎이고, 그래서 사이드카 키의 집이다. 등록부
 * (`lib/survey/response-sidecars`)가 키를 소유하면 그 등록부를 쓰는 모듈들과
 * 순환이 닫혀, 모듈 진입 순서에 따라 `__changeConfirm__` 이 등록부에서 조용히
 * 빠지는 사고가 난다(2026-09-16 발견). **여기에 새 import 를 넣지 말 것.**
 */

/** 보기 상세기재 사이드카 키. 응답 루트 예약 키(`__` 접두) 중 하나다. */
export const OPT_TEXTS_KEY = '__optTexts__';
/**
 * questionResponses 루트의 __optTexts__ 사이드카 전체를 안전하게 추출한다.
 * 이어가기/admin 편집 시드에서 Zustand optionTexts 로 되살릴 때 사용 (없으면 빈 객체).
 */
export function readOptTextsSidecar(
  qResponses: Record<string, unknown> | null | undefined,
): Record<string, Record<string, string>> {
  const sidecar = qResponses?.[OPT_TEXTS_KEY];
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [questionId, texts] of Object.entries(sidecar as Record<string, unknown>)) {
    if (!texts || typeof texts !== 'object' || Array.isArray(texts)) continue;
    const entries = Object.entries(texts as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    if (entries.length > 0) out[questionId] = Object.fromEntries(entries);
  }
  return out;
}

export function getOptionText(
  qResponses: Record<string, unknown> | null | undefined,
  questionId: string,
  optionId: string,
): string | undefined {
  if (!qResponses) return undefined;
  const sidecar = (qResponses as { __optTexts__?: Record<string, Record<string, string>> }).__optTexts__;
  const fromSidecar = sidecar?.[questionId]?.[optionId];
  if (fromSidecar) return fromSidecar;
  const perQuestion = qResponses[questionId];
  if (typeof perQuestion === 'object' && perQuestion !== null && 'optionTexts' in perQuestion) {
    const legacyText = (perQuestion as { optionTexts?: Record<string, string> }).optionTexts?.[optionId];
    if (legacyText) return legacyText;
  }
  return undefined;
}
