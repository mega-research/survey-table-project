import type { SurveyLocale } from '@/types/survey-locale';
import {
  type SystemStringKey,
  type SystemStringValues,
  systemText,
  systemTextLines,
} from '@/utils/system-strings';

/**
 * 안내 화면의 시스템 문장 (CONTEXT.md 「다국어 설문」). 언어가 정해졌으면 그 언어 문장 하나를
 * 글자 그대로 — 감싸는 요소 없이 — 내므로 다국어 아닌 설문의 화면은 지금과 같다. 미정(`null`)이면
 * 한국어 · 中文 · English 를 한 줄씩 쌓고, 줄마다 `lang` 을 단다.
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
  if (locale !== null) return <>{systemText(k, locale, values)}</>;
  return (
    <>
      {systemTextLines(k, null, values).map((line) => (
        <span key={line.locale} lang={line.locale} className="block">
          {line.text}
        </span>
      ))}
    </>
  );
}
