import { isUntouchedPriorValue } from '@/lib/survey/prior-answers';
import type { TableCell } from '@/types/survey';
import { DEFAULT_SURVEY_LOCALE, type SurveyLocale } from '@/types/survey-locale';

import { type TextQualityViolation, isPlainTextInput, textQualityViolation } from './text-quality';
import { cellLockTemplate, isTokenPrefilled } from './token-prefill';

/**
 * 표 input 셀 하나의 응답 품질 위반 — 셀 렌더러(표·보기 표 사이드카)와 차단 검증이 같은 판정을 쓴다.
 * 평문 모드 셀만 대상이고, 토큰 prefill 로 잠긴 셀(명단 값이 있는 셀)과 손대지 않은 이월 값은
 * 보지 않는다(문항과 같은 규칙).
 *
 * 셀 렌더러(cells/input-cell·option-text-input)와 응답 흐름의 차단 검증(survey-response/lib/
 * numeric-validation)이 함께 부른다. 의존 방향이 response → renderer 라 사슬 최하단인
 * renderer/utils 가 소유한다 (AGENTS.md "src/lib 잔류 기준").
 */
export function resolveCellTextQualityViolation(
  cell: {
    inputType?: TableCell['inputType'] | undefined;
    defaultValueTemplate?: string | null | undefined;
    prefillEditable?: boolean | undefined;
    textValidation?: TableCell['textValidation'] | undefined;
  },
  value: unknown,
  attrs: Record<string, string | undefined> | null | undefined,
  priorOriginal?: string | null,
  locale: SurveyLocale = DEFAULT_SURVEY_LOCALE,
): TextQualityViolation | null {
  if (!cell.textValidation || !isPlainTextInput({ type: 'text', inputType: cell.inputType })) {
    return null;
  }
  if (isTokenPrefilled(cellLockTemplate(cell), attrs)) return null;
  if (typeof value === 'string' && isUntouchedPriorValue(value, priorOriginal ?? null)) return null;
  return textQualityViolation(cell.textValidation, value, locale);
}
