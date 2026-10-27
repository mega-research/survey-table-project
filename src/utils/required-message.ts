import type { Question } from '@/types/survey';
import { DEFAULT_SURVEY_LOCALE, type SurveyLocale } from '@/types/survey-locale';
import { systemText } from '@/utils/system-strings';

/** 필수 미응답 안내 기본 문구 — 빌더 input placeholder 와 응답 화면 폴백의 SSOT. */
export const DEFAULT_REQUIRED_MESSAGE = systemText('validation.required');

/** 필수 응답 셀 미응답 기본 문구 — 셀 모달 placeholder 와 숫자 검증 이슈 메시지의 SSOT. */
export const DEFAULT_REQUIRED_CELL_MESSAGE = systemText('validation.requiredCell');

/** 필수 응답 셀 미응답 기본 문구의 현재 언어판 (CONTEXT.md 「다국어 설문」). */
export function requiredCellMessage(locale: SurveyLocale = DEFAULT_SURVEY_LOCALE): string {
  return systemText('validation.requiredCell', locale);
}

/**
 * 질문의 필수 안내 문구 — 사용자 지정이 공백뿐이면 기본 문구로 폴백.
 * 저작자 문구는 번역하지 않는다(언어판마다 저작자가 쓴다). 기본 문구만 현재 언어를 따른다.
 */
export function resolveRequiredMessage(
  question: Pick<Question, 'requiredMessage'>,
  locale: SurveyLocale = DEFAULT_SURVEY_LOCALE,
): string {
  const custom = question.requiredMessage?.trim();
  return custom || systemText('validation.required', locale);
}
