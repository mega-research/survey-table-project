import type { Question } from '@/types/survey';

import { getOtherOptionCode } from '@/utils/option-code-generator';

export interface ValidationError {
  code:
    | 'EMPTY'
    | 'INVALID_START_CHAR'
    | 'INVALID_CHARS'
    | 'TOO_LONG'
    | 'RESERVED_WORD'
    | 'DUPLICATE'
    | 'SUB_VAR_CONFLICT';
  message: string;
  questionId?: string;
  varName?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const SPSS_RESERVED_WORDS = new Set([
  'ALL', 'AND', 'BY', 'EQ', 'GE', 'GT',
  'LE', 'LT', 'NE', 'NOT', 'OR', 'TO', 'WITH',
]);

/**
 * 단일 SPSS 변수명의 유효성을 검증한다.
 * - 영문자로 시작
 * - 영문자, 숫자, 밑줄만 허용 (대시는 SPSS 금지 문자 — sav-writer가 export 전체를
 *   거부하므로 입력 단계에서 차단한다)
 * - 연속 밑줄·후행 밑줄 금지 (sanitizeSpssVarName이 변형하는 이름을 사전 차단해
 *   "검증 통과 = sanitize no-op" 불변식을 보장한다)
 * - 최대 64자
 * - SPSS 예약어 불가
 */
export function validateSpssVarName(name: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (name.length === 0) {
    errors.push({ code: 'EMPTY', message: '변수명이 비어있습니다.' });
    return { valid: false, errors };
  }

  if (!/^[a-zA-Z]/.test(name)) {
    errors.push({
      code: 'INVALID_START_CHAR',
      message: '변수명은 영문자로 시작해야 합니다.',
    });
  }

  if (/[^a-zA-Z0-9_]/.test(name)) {
    errors.push({
      code: 'INVALID_CHARS',
      message: '변수명에 허용되지 않는 문자가 포함되어 있습니다. 영문자, 숫자, 밑줄만 허용됩니다.',
    });
  }

  if (/__/.test(name)) {
    errors.push({
      code: 'INVALID_CHARS',
      message: '연속 밑줄은 허용되지 않습니다.',
    });
  }

  if (name.endsWith('_')) {
    errors.push({
      code: 'INVALID_CHARS',
      message: '변수명은 밑줄로 끝날 수 없습니다.',
    });
  }

  if (name.length > 64) {
    errors.push({
      code: 'TOO_LONG',
      message: `변수명이 너무 깁니다. (${name.length}자, 최대 64자)`,
    });
  }

  if (SPSS_RESERVED_WORDS.has(name.toUpperCase())) {
    errors.push({
      code: 'RESERVED_WORD',
      message: `'${name}'은(는) SPSS 예약어입니다.`,
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 질문 목록에서 중복 변수명을 검출한다.
 * - 대소문자 구분 없이 비교
 * - questionCode가 없는 질문은 무시
 */
export function validateNoDuplicates(questions: Question[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Map<string, string>(); // upperName -> questionId

  for (const q of questions) {
    if (!q.questionCode) continue;

    const upper = q.questionCode.toUpperCase();
    if (seen.has(upper)) {
      errors.push({
        code: 'DUPLICATE',
        message: `변수명 '${q.questionCode}'이(가) 중복됩니다.`,
        questionId: q.id,
        varName: q.questionCode,
      });
    } else {
      seen.set(upper, q.id);
    }
  }

  return errors;
}

/**
 * checkbox 질문의 하위 변수명(Q2_1, Q2_2...)과
 * 다른 질문의 변수명이 충돌하는지 검사한다.
 */
export function validateNoSubVarConflicts(questions: Question[]): ValidationError[] {
  const errors: ValidationError[] = [];

  // 모든 질문의 변수명 수집 (대문자)
  const allVarNames = new Map<string, string>(); // upperName -> questionId
  for (const q of questions) {
    if (q.questionCode) {
      allVarNames.set(q.questionCode.toUpperCase(), q.id);
    }
  }

  // checkbox 질문의 하위 변수명 생성 후 충돌 검사
  for (const q of questions) {
    if (q.type !== 'checkbox' || !q.questionCode || !q.options) continue;

    for (let i = 0; i < q.options.length; i++) {
      const opt = q.options[i];
      if (!opt) continue;
      const optCode = opt.optionCode ?? String(i + 1);
      const subVarName = `${q.questionCode}_${optCode}`;
      const subVar = subVarName.toUpperCase();
      const conflictId = allVarNames.get(subVar);

      if (conflictId && conflictId !== q.id) {
        errors.push({
          code: 'SUB_VAR_CONFLICT',
          message: `체크박스 '${q.questionCode}'의 하위 변수 '${subVarName}'이(가) 다른 질문의 변수명과 충돌합니다.`,
          questionId: q.id,
          varName: subVarName,
        });
      }
    }
  }

  // 기타 옵션의 _etc 하위 변수명 충돌 검사
  for (const q of questions) {
    if (!q.allowOtherOption || !q.questionCode) continue;

    const etcVarName = `${q.questionCode}_${getOtherOptionCode(q.options)}_etc`;
    const etcVar = etcVarName.toUpperCase();
    const conflictId = allVarNames.get(etcVar);

    if (conflictId && conflictId !== q.id) {
      errors.push({
        code: 'SUB_VAR_CONFLICT',
        message: `'${q.questionCode}'의 기타 변수 '${etcVarName}'이(가) 다른 질문의 변수명과 충돌합니다.`,
        questionId: q.id,
        varName: etcVarName,
      });
    }
  }

  return errors;
}
