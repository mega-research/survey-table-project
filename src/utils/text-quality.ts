import type { TextValidation } from '@/types/survey';

/**
 * 단답형·장문형 응답 품질 검사 — 최소 글자 수와 "의미 없는 입력" 거부.
 *
 * 형식 검사(`input-format.ts`)와 같은 자리(클라이언트 차단, ADR 0023)에 붙지만 대상이
 * 다르다 — 저쪽은 전화번호·이메일처럼 값의 **모양**을, 이쪽은 자유 서술의 **성의**를 본다.
 * 정규식 사용자 정의는 두지 않는다(잘못 쓴 정규식 하나가 응답을 통째로 막는다).
 */

export type TextQualityReason = 'min_length' | 'meaningless';

export interface TextQualityViolation {
  reason: TextQualityReason;
  message: string;
}

/** 공백을 뺀 글자 수 — 코드 포인트 단위. "a         b" 로 글자 수를 채우지 못하게 한다. */
export function countAnswerChars(value: string): number {
  return [...value.replace(/\s+/gu, '')].length;
}

/** 한글 자모(호환 자모 + 첫가끝 자모)와 숫자 — 이것만으로 이뤄진 값은 내용이 없다고 본다. */
const JAMO_OR_DIGIT_ONLY = /^[ㄱ-ㆎᄀ-ᇿꥠ-꥿ힰ-퟿0-9]*$/u;

/**
 * 자음·모음·숫자만인 입력인가 — ㅋㅋㅋ · ㅎㅎ · ㅇㅇ · 123124 · "..." 류.
 *
 * 공백과 문장부호·기호를 걷어낸 뒤 남은 글자가 전부 자모·숫자이거나 아무것도 남지 않으면
 * 참이다. 완성형 한글·영문·한자가 하나라도 있으면 거짓 — "아 진짜 ㅋㅋㅋ" 는 내용이 있다.
 * 빈 값은 거짓(미입력 차단은 필수 판정 소관).
 */
export function isMeaninglessText(value: string): boolean {
  if (value.trim() === '') return false;
  const stripped = value.replace(/[\s\p{P}\p{S}]+/gu, '');
  return JAMO_OR_DIGIT_ONLY.test(stripped);
}

export const MEANINGLESS_TEXT_MESSAGE =
  '자음·모음이나 숫자만으로는 답할 수 없습니다. 내용을 입력해 주세요.';

export function minLengthMessage(minLength: number, current: number): string {
  return `${minLength}자 이상 입력해 주세요. (현재 ${current}자, 공백 제외)`;
}

/** 빌더가 저장한 최소 글자 수 — 양의 정수일 때만 뜻이 있다. */
export function effectiveMinLength(config: TextValidation | null | undefined): number | null {
  const n = config?.minLength;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 값 하나를 문항의 품질 설정에 비추어 본다. 통과·빈 값·문자열이 아니면 null.
 * 둘 다 걸리면 "의미 없는 입력" 을 먼저 알린다 — 글자 수를 채워도 통과하지 못하는 값이다.
 */
export function textQualityViolation(
  config: TextValidation | null | undefined,
  value: unknown,
): TextQualityViolation | null {
  if (!config || typeof value !== 'string' || value.trim() === '') return null;
  if (config.rejectMeaningless === true && isMeaninglessText(value)) {
    return { reason: 'meaningless', message: MEANINGLESS_TEXT_MESSAGE };
  }
  const min = effectiveMinLength(config);
  if (min !== null) {
    const current = countAnswerChars(value);
    if (current < min) {
      return { reason: 'min_length', message: minLengthMessage(min, current) };
    }
  }
  return null;
}
