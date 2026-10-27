import type { LocalizedSurveyTexts } from '@/shared/contracts/survey';
import { DEFAULT_SURVEY_LOCALE, type SurveyLocale } from '@/types/survey-locale';
import { systemText } from '@/utils/system-strings';

import { localizedField } from './localized-survey-texts';

/** 응답이 끝난 방식 — CONTEXT.md 「종료 결과」. 쿼터마감은 별도 차단 화면이라 여기 없다. */
export type CompletionOutcome = 'completed' | 'screened_out';

/**
 * 종료 결과에 맞는 완료 화면 제목·문구.
 * 자격미달은 「자격미달 종료 문구」를 쓰되 비어 있으면 완료 문구로 폴백한다 — 기존 설문은
 * 채우기 전까지 아무것도 달라지지 않는다. 제목은 고정값이다(CONTEXT.md 「자격미달 종료 문구」) — 현재 언어의 시스템 문장이다.
 *
 * 다국어 설문은 현재 언어의 문구를 먼저 본다(CONTEXT.md 「다국어 설문」). 같은 언어 안에서
 * 자격미달 → 완료 문구로 폴백하고, 그 언어에 둘 다 없으면 한국어 사슬로 간다 — 다른 언어 응답자에게
 * 한국어 자격미달 문구보다 자기 언어의 완료 문구가 낫다.
 */
export function resolveCompletionScreen(
  settings: {
    thankYouMessage: string;
    screenedOutMessage?: string | null | undefined;
    localizedMessages?: LocalizedSurveyTexts | null | undefined;
  },
  outcome: CompletionOutcome,
  locale: SurveyLocale | null = DEFAULT_SURVEY_LOCALE,
): { title: string; message: string } {
  const ownThankYou = localizedField(settings.localizedMessages, locale, 'thankYou');
  if (outcome === 'screened_out') {
    const message =
      localizedField(settings.localizedMessages, locale, 'screenedOut') ??
      ownThankYou ??
      nonBlank(settings.screenedOutMessage) ??
      settings.thankYouMessage;
    return { title: systemText('completion.screenedOutTitle', locale), message };
  }
  return {
    title: systemText('completion.title', locale),
    message: ownThankYou ?? settings.thankYouMessage,
  };
}

function nonBlank(text: string | null | undefined): string | undefined {
  return text && text.trim() !== '' ? text : undefined;
}

/** complete 결과 행의 상태 → 종료 결과. 알 수 없는 값은 완료로 본다(기존 동작 보존). */
export function outcomeFromStatus(status: string | null | undefined): CompletionOutcome {
  return status === 'screened_out' ? 'screened_out' : 'completed';
}
