/**
 * 언어별 설문 글자 고르기 (CONTEXT.md 「다국어 설문」) — 제목·설명·완료 문구·자격미달 문구.
 *
 * 한국어는 설문의 기존 칸이고 다른 언어는 `localizedMessages` 에 있다. 현재 언어의 칸이 비어
 * 있으면 한국어로 폴백한다. 응답 화면 머리·첫 페이지 설명·완료 화면(`completion-screen`)이 같은
 * 규칙을 쓴다.
 */
import type { LocalizedSurveyText, LocalizedSurveyTexts } from '@/shared/contracts/survey';
import { DEFAULT_SURVEY_LOCALE, SURVEY_LOCALES, type SurveyLocale } from '@/types/survey-locale';

/** 그 언어 칸의 글자 — 기본 언어·미정이거나 비어(공백뿐이어) 있으면 없다. */
export function localizedField(
  localized: LocalizedSurveyTexts | null | undefined,
  locale: SurveyLocale | null,
  key: keyof LocalizedSurveyText,
): string | undefined {
  if (locale === null || locale === DEFAULT_SURVEY_LOCALE) return undefined;
  const text = localized?.[locale]?.[key];
  return text && text.trim() !== '' ? text : undefined;
}

export function pickLocalizedText(
  base: string,
  localized: LocalizedSurveyTexts | null | undefined,
  locale: SurveyLocale | null,
  key: keyof LocalizedSurveyText,
): string {
  return localizedField(localized, locale, key) ?? base;
}

/**
 * 머리 글자 목록 — 언어가 정해지면 그 언어 하나(폴백 한국어), 미정이면 등록된 언어의 글자를
 * 언어 순서대로 모은다. 빈 글자와 같은 글자는 한 번만.
 */
function headerTexts(
  base: string,
  localized: LocalizedSurveyTexts | null | undefined,
  locale: SurveyLocale | null,
  key: keyof LocalizedSurveyText,
): string[] {
  const all =
    locale !== null
      ? [pickLocalizedText(base, localized, locale, key)]
      : SURVEY_LOCALES.map((l) =>
          l === DEFAULT_SURVEY_LOCALE ? base : (localizedField(localized, l, key) ?? ''),
        );
  return [...new Set(all.filter((t) => t.trim() !== ''))];
}

/**
 * 응답 화면 머리 제목. 언어가 정해지기 전(미정)에는 등록된 언어의 제목을 한국어 · 中文 · English
 * 순으로 한 줄씩 쌓는다 — 처음 링크를 연 외국 응답자가 한국어 제목만 보지 않게(2026-10-27 결정).
 */
export function resolveHeaderTitle(
  baseTitle: string,
  localized: LocalizedSurveyTexts | null | undefined,
  locale: SurveyLocale | null,
): string {
  return headerTexts(baseTitle, localized, locale, 'title').join('\n') || baseTitle;
}

/**
 * 첫 페이지 설명 문단들. 설명은 첫 페이지에만 나오고 언어 문항도 첫 페이지라 그 자리는 대개
 * 미정이다 — 제목과 같이 등록된 언어의 설명을 문단 하나씩 보인다.
 */
export function resolveHeaderDescriptions(
  baseDescription: string,
  localized: LocalizedSurveyTexts | null | undefined,
  locale: SurveyLocale | null,
): string[] {
  return headerTexts(baseDescription, localized, locale, 'description');
}
