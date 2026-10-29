/**
 * 다국어 설문의 언어 어휘 (CONTEXT.md 「언어 문항」).
 *
 * 언어 문항의 보기(`QuestionOption.locale`)에 붙고, 응답 화면의 시스템 글자와 언어별 설문 글자가
 * 이 값으로 갈린다. 보기 필드라 `options` JSONB 안에 저장되어 DB 제약이 없다.
 */
export const SURVEY_LOCALES = ['ko', 'zh', 'en'] as const;

export type SurveyLocale = (typeof SURVEY_LOCALES)[number];

/** 다국어 설문이 아니거나 언어 컨텍스트 밖이면 이 언어다 — 기존 화면 글자가 그대로 나온다. */
export const DEFAULT_SURVEY_LOCALE = 'ko' satisfies SurveyLocale;

/** 기본 언어 밖 언어 — 언어별 설문 글자(`localizedMessages`)에 칸이 있는 언어들. */
export type TranslatedSurveyLocale = Exclude<SurveyLocale, typeof DEFAULT_SURVEY_LOCALE>;

export const TRANSLATED_SURVEY_LOCALES = SURVEY_LOCALES.filter(
  (l): l is TranslatedSurveyLocale => l !== DEFAULT_SURVEY_LOCALE,
);

/** 언어 이름 — 각 언어로 적는다(고르는 사람이 읽을 수 있게). */
export const SURVEY_LOCALE_LABELS: Record<SurveyLocale, string> = {
  ko: '한국어',
  zh: '中文',
  en: 'English',
};

/**
 * 한 줄짜리 시스템 글자(버튼·검증 문구·토스트)의 언어 — 미정(`null`)이면 한국어.
 * 세 언어를 위아래로 쌓는 것은 전체 화면 안내뿐이다(CONTEXT.md 「다국어 설문」).
 */
export function toInlineLocale(locale: SurveyLocale | null | undefined): SurveyLocale {
  return locale ?? DEFAULT_SURVEY_LOCALE;
}

export function isSurveyLocale(value: unknown): value is SurveyLocale {
  return typeof value === 'string' && (SURVEY_LOCALES as readonly string[]).includes(value);
}
