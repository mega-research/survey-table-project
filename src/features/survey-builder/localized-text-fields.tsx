'use client';

import { useShallow } from 'zustand/react/shallow';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { withLocalizedText } from '@/features/survey-builder/utils/localized-texts';
import type { LocalizedSurveyText, LocalizedSurveyTexts } from '@/shared/contracts/survey';
import { SURVEY_LOCALE_LABELS, TRANSLATED_SURVEY_LOCALES } from '@/types/survey-locale';
import { findLanguageQuestion } from '@/utils/survey-language';

/** 설문에 언어 문항이 있는가 — 있을 때만 언어별 입력칸을 보인다(CONTEXT.md 「언어 문항」). */
export function useHasLanguageQuestion(): boolean {
  const { questions, groups } = useSurveyBuilderStore(
    useShallow((s) => ({ questions: s.currentSurvey.questions, groups: s.currentSurvey.groups })),
  );
  return findLanguageQuestion(questions, groups ?? []) !== null;
}

/**
 * 언어별 설문 글자 입력칸 (CONTEXT.md 「다국어 설문」) — 한국어 칸 아래에 中文·English 칸을 둔다.
 * 비워 두면 응답 화면은 한국어 글자를 쓴다. 부르는 쪽이 `useHasLanguageQuestion` 으로 보일지 정한다.
 */
export function LocalizedTextFields({
  field,
  label,
  texts,
  onChange,
  multiline = false,
}: {
  field: keyof LocalizedSurveyText;
  label: string;
  texts: LocalizedSurveyTexts | null | undefined;
  onChange: (next: LocalizedSurveyTexts | null) => void;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-2">
      {TRANSLATED_SURVEY_LOCALES.map((locale) => {
        const id = `localized-${field}-${locale}`;
        const value = texts?.[locale]?.[field] ?? '';
        const handle = (next: string) => onChange(withLocalizedText(texts, locale, field, next));
        return (
          <div key={locale} className="space-y-1">
            <Label htmlFor={id} className="text-xs font-normal text-gray-600">
              {label} ({SURVEY_LOCALE_LABELS[locale]})
            </Label>
            {multiline ? (
              <Textarea
                id={id}
                value={value}
                onChange={(e) => handle(e.target.value)}
                rows={2}
                className="resize-none"
              />
            ) : (
              <Input id={id} value={value} onChange={(e) => handle(e.target.value)} />
            )}
          </div>
        );
      })}
      <p className="text-xs text-gray-400">
        비워 두면 그 언어 응답자에게도 한국어 글자가 나옵니다.
      </p>
    </div>
  );
}
