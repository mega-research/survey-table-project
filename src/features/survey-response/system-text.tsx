'use client';

import { type ReactNode, createContext, useContext } from 'react';

import { DEFAULT_SURVEY_LOCALE, SURVEY_LOCALES, type SurveyLocale } from '@/types/survey-locale';
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
 * 전체 화면 안내(완료·차단·PC 안내 등)의 루트에 다는 `lang` — 언어가 정해진 다국어 응답이면 그 언어다.
 * 그 화면들은 `lang` 을 단 본문 컨테이너보다 앞에서 그려져, 달지 않으면 언어별 글꼴 규칙(`[lang|="vi"]`·`[lang|="zh"]`)
 * 과 스크린리더 발음이 빠진다. 한국어(다국어 아닌 설문)와 미정은 달지 않는다 — 종전 화면 그대로이고, 미정은 줄마다 단다.
 */
export function screenLang(locale: SurveyLocale | null | undefined): SurveyLocale | undefined {
  return locale && locale !== DEFAULT_SURVEY_LOCALE ? locale : undefined;
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
