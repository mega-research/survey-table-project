/**
 * 다국어 설문의 언어 어휘 (CONTEXT.md 「언어 문항」).
 *
 * 언어 문항의 보기(`QuestionOption.locale`)에 붙고, 응답 화면의 시스템 글자와 언어별 설문 글자가
 * 이 값으로 갈린다. 보기 필드라 `options` JSONB 안에 저장되어 DB 제약이 없다.
 */
export const SURVEY_LOCALES = ['ko', 'zh', 'en'] as const;

export type SurveyLocale = (typeof SURVEY_LOCALES)[number];

/** 다국어 설문이 아니거나 언어 컨텍스트 밖이면 이 언어다 — 기존 화면 글자가 그대로 나온다. */
export const DEFAULT_SURVEY_LOCALE: SurveyLocale = 'ko';

/** 언어 이름 — 각 언어로 적는다(고르는 사람이 읽을 수 있게). */
export const SURVEY_LOCALE_LABELS: Record<SurveyLocale, string> = {
  ko: '한국어',
  zh: '中文',
  en: 'English',
};

export function isSurveyLocale(value: unknown): value is SurveyLocale {
  return typeof value === 'string' && (SURVEY_LOCALES as readonly string[]).includes(value);
}
