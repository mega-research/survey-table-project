'use client';

import { type ReactNode, createContext, useContext } from 'react';

import { SURVEY_LOCALES, type SurveyLocale } from '@/types/survey-locale';
import {
  type SystemStringKey,
  type SystemStringValues,
  systemText,
  systemTextLines,
} from '@/utils/system-strings';

/**
 * 설문이 제공하는 언어 (`resolveOfferedLocales`) — 언어가 정해지기 전 안내 화면이 쌓는 언어다.
 * 응답 흐름이 설문을 읽은 뒤 공급한다. 공급자 밖은 어휘 전체다.
 */
const OfferedLocalesContext = createContext<readonly SurveyLocale[]>(SURVEY_LOCALES);

export function OfferedLocalesProvider({
  locales,
  children,
}: {
  locales: readonly SurveyLocale[];
  children: ReactNode;
}) {
  return <OfferedLocalesContext.Provider value={locales}>{children}</OfferedLocalesContext.Provider>;
}

/**
 * 안내 화면의 시스템 문장 (CONTEXT.md 「다국어 설문」). 언어가 정해졌으면 그 언어 문장 하나를
 * 글자 그대로 — 감싸는 요소 없이 — 내므로 다국어 아닌 설문의 화면은 지금과 같다. 미정(`null`)이면
 * 그 설문이 제공하는 언어를 어휘 순서로 한 줄씩 쌓고, 줄마다 `lang` 을 단다.
 */
export function SystemText({
  k,
  locale,
  values,
}: {
  k: SystemStringKey;
  locale: SurveyLocale | null;
  values?: SystemStringValues;
}) {
  const offered = useContext(OfferedLocalesContext);
  if (locale !== null) return <>{systemText(k, locale, values)}</>;
  return (
    <>
      {systemTextLines(k, null, values, offered).map((line) => (
        <span key={line.locale} lang={line.locale} className="block">
          {line.text}
        </span>
      ))}
    </>
  );
}
