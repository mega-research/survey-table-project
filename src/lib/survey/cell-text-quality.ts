import { isUntouchedPriorValue } from '@/lib/survey/prior-answers';
import type { TableCell } from '@/types/survey';
import {
  type TextQualityViolation,
  isPlainTextInput,
  textQualityViolation,
} from '@/utils/text-quality';

/**
 * 표 input 셀 하나의 응답 품질 위반 — 셀 렌더러(표·보기 표 사이드카)와 차단 검증이 같은 판정을 쓴다.
 * 평문 모드 셀만 대상이고, 토큰 prefill 셀과 손대지 않은 이월 값은 보지 않는다(문항과 같은 규칙).
 *
 * 렌더러(question-renderer)와 응답 흐름의 검증(numeric-validation)이 함께 부르므로 lib 에 둔다 —
 * 렌더러는 feature 를 import 할 수 없다.
 */
export function resolveCellTextQualityViolation(
  cell: {
    inputType?: TableCell['inputType'] | undefined;
    defaultValueTemplate?: string | null | undefined;
    textValidation?: TableCell['textValidation'] | undefined;
  },
  value: unknown,
  priorOriginal?: string | null,
): TextQualityViolation | null {
  if (!cell.textValidation || !isPlainTextInput({ type: 'text', inputType: cell.inputType })) {
    return null;
  }
  if (isTokenPrefilled(cell.defaultValueTemplate)) return null;
  if (typeof value === 'string' && isUntouchedPriorValue(value, priorOriginal ?? null)) return null;
  return textQualityViolation(cell.textValidation, value);
}

function isTokenPrefilled(template: string | null | undefined): boolean {
  return (template ?? '').trim().length > 0;
}
