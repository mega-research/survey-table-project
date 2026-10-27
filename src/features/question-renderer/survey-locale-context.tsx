'use client';

import { type ReactNode, createContext, useContext } from 'react';

import { DEFAULT_SURVEY_LOCALE, type SurveyLocale } from '@/types/survey-locale';

/**
 * 응답 화면의 현재 언어 (CONTEXT.md 「언어 문항」). 언어 문항의 답에서 파생한 값을 응답 화면과
 * 빌더 미리보기가 공급한다(`resolveCurrentLocale`). `null` 은 다국어 설문에서 아직 고르지 않은 미정이다.
 */
const SurveyLocaleContext = createContext<SurveyLocale | null>(DEFAULT_SURVEY_LOCALE);

export function SurveyLocaleProvider({
  locale,
  children,
}: {
  locale: SurveyLocale | null;
  children: ReactNode;
}) {
  return <SurveyLocaleContext.Provider value={locale}>{children}</SurveyLocaleContext.Provider>;
}

/** Provider 밖(관리자 화면·레거시)에서는 한국어 — 기존 화면 글자가 그대로다. */
export function useSurveyLocale(): SurveyLocale | null {
  return useContext(SurveyLocaleContext);
}

/**
 * 한 줄짜리 시스템 글자(검증 문구·입력칸 안내)의 언어 — 미정이면 한국어.
 * 세 언어를 위아래로 쌓는 것은 전체 화면 안내뿐이다(응답 흐름의 `inlineLocale` 과 같은 규칙).
 */
export function useInlineSurveyLocale(): SurveyLocale {
  return useSurveyLocale() ?? DEFAULT_SURVEY_LOCALE;
}
