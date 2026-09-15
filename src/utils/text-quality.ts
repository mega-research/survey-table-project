import { isInputFormat } from '@/types/input-type';
import type { InputType, TextValidation } from '@/types/survey';

/**
 * 단답형·장문형 응답 품질 검사 — 최소 글자 수와 "의미 없는 입력" 거부.
 *
 * 형식 검사(`input-format.ts`)와 같은 자리(클라이언트 차단, ADR 0023)에 붙지만 대상이
 * 다르다 — 저쪽은 전화번호·이메일처럼 값의 **모양**을, 이쪽은 자유 서술의 **성의**를 본다.
 * 정규식 사용자 정의는 두지 않는다(잘못 쓴 정규식 하나가 응답을 통째로 막는다).
 */

export type TextQualityReason = 'min_length' | 'max_length' | 'meaningless';

/**
 * 응답 품질 검사가 붙는 입력인가 — 장문형, 그리고 평문 모드 단답형.
 * 숫자 모드·입력 형식 단답형은 자기 검사가 있어 배타다. 빌더(설정 잠금)·응답 화면·검증이 같이 쓴다.
 */
export function isPlainTextInput(question: {
  type: string;
  inputType?: InputType | null | undefined;
}): boolean {
  if (question.type === 'textarea') return true;
  if (question.type !== 'text') return false;
  return question.inputType !== 'number' && !isInputFormat(question.inputType);
}

/**
 * 빌더가 저장할 설정으로 정리한다 — 양의 정수 최소 글자 수와 켜진 토글만 남기고,
 * 둘 다 없으면 null(패치에서 undefined 는 "손대지 않음" 이라 지우려면 null 이어야 한다).
 */
export function normalizeTextValidation(
  config:
    | {
        minLength?: number | null | undefined;
        maxLength?: number | null | undefined;
        rejectMeaningless?: boolean | null | undefined;
      }
    | null
    | undefined,
): TextValidation | null {
  const out: TextValidation = {};
  const min = positiveInt(config?.minLength);
  const max = positiveInt(config?.maxLength);
  if (min !== null) out.minLength = min;
  if (max !== null) out.maxLength = max;
  if (config?.rejectMeaningless === true) out.rejectMeaningless = true;
  return Object.keys(out).length > 0 ? out : null;
}

function positiveInt(n: unknown): number | null {
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

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
 * 의미 없는 입력인가 — 두 가지 모양을 잡는다.
 * 1. 자음·모음·숫자만: ㅋㅋㅋ · ㅎㅎ · ㅇㅇ · 123124 · "..." (공백·문장부호·기호를 걷어낸 뒤
 *    남은 글자가 전부 자모·숫자이거나 아무것도 남지 않음).
 * 2. 짧은 단위 반복: 한두 글자짜리 단위가 두 번 이상 되풀이됨 — aaaaa · 하하하하 · 네네네 · abab.
 * 완성형 한글·영문·한자가 섞인 보통 문장은 거짓 — "아 진짜 ㅋㅋㅋ" 는 내용이 있다.
 * 빈 값은 거짓(미입력 차단은 필수 판정 소관).
 */
export function isMeaninglessText(value: string): boolean {
  if (value.trim() === '') return false;
  const stripped = value.replace(/[\s\p{P}\p{S}]+/gu, '');
  if (JAMO_OR_DIGIT_ONLY.test(stripped)) return true;
  // 짧은 단위 반복 — 한두 글자짜리 단위가 두 번 이상 되풀이됨(aaaaa · 하하하하 · 네네네 · abab).
  // 완성형 글자라도 성의 있는 답이 아니다. 자판 훑기(qwer)까지 판정하지는 않는 휴리스틱이다.
  return isShortUnitRepetition([...stripped]);
}

/** 길이 1~2 단위가 두 번 이상 되풀이된 글자열인가 — aaaa · 하하하 · abab. 세 글자 이상 단위는 보지 않는다. */
function isShortUnitRepetition(chars: string[]): boolean {
  for (const unit of [1, 2]) {
    if (chars.length < unit * 2 || chars.length % unit !== 0) continue;
    const head = chars.slice(0, unit).join('');
    let repeated = true;
    for (let i = unit; i < chars.length; i += unit) {
      if (chars.slice(i, i + unit).join('') !== head) {
        repeated = false;
        break;
      }
    }
    if (repeated) return true;
  }
  return false;
}

export const MEANINGLESS_TEXT_MESSAGE =
  '자음·모음이나 숫자만으로는 답할 수 없습니다. 내용을 입력해 주세요.';

export function minLengthMessage(minLength: number, current: number): string {
  return `${minLength}자 이상 입력해 주세요. (현재 ${current}자, 공백 제외)`;
}

/** 빌더가 저장한 최소 글자 수 — 양의 정수일 때만 뜻이 있다. */
export function effectiveMinLength(config: TextValidation | null | undefined): number | null {
  return positiveInt(config?.minLength);
}

/** 입력 상한(공백 포함) — 표 input 셀의 inputMaxLength 와 같은 하드 캡. 양의 정수일 때만. */
export function effectiveMaxLength(config: TextValidation | null | undefined): number | null {
  return positiveInt(config?.maxLength);
}

export function maxLengthMessage(maxLength: number, current: number): string {
  return `${maxLength}자 이하로 입력해 주세요. (현재 ${current}자)`;
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
  // 상한은 입력칸이 이미 막지만, 붙여넣기·설정 전 값·이월 값이 넘어올 수 있어 여기서도 본다.
  // 입력칸의 maxLength 와 같은 단위(공백 포함 길이)로 센다.
  const max = effectiveMaxLength(config);
  if (max !== null && value.length > max) {
    return { reason: 'max_length', message: maxLengthMessage(max, value.length) };
  }
  return null;
}
