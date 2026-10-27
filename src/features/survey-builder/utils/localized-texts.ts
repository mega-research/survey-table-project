import type { LocalizedSurveyText, LocalizedSurveyTexts } from '@/shared/contracts/survey';
import type { TranslatedSurveyLocale } from '@/types/survey-locale';

/** 한 칸을 바꾼 새 묶음 — 빈 값은 키를 지우고, 남은 것이 없으면 null(한국어만). */
export function withLocalizedText(
  texts: LocalizedSurveyTexts | null | undefined,
  locale: TranslatedSurveyLocale,
  field: keyof LocalizedSurveyText,
  value: string,
): LocalizedSurveyTexts | null {
  const next: LocalizedSurveyTexts = { ...texts };
  const entry: LocalizedSurveyText = { ...next[locale] };
  if (value.trim() === '') delete entry[field];
  else entry[field] = value;
  if (Object.keys(entry).length === 0) delete next[locale];
  else next[locale] = entry;
  return Object.keys(next).length === 0 ? null : next;
}
