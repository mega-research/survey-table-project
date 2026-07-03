import type { Question, QuestionOption, RankingAnswer } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { parseNumericInput } from '@/utils/numeric-input';
import { RANKING_OTHER_VALUE } from '@/utils/ranking-shared';
import { unwrapOptionId } from '@/utils/table-cell-semantics';

export interface SPSSColumn {
  spssVarName: string;
  questionText: string;
  optionLabel: string;
  questionId: string;
  type: 'single' | 'checkbox-item' | 'text' | 'multiselect' | 'table-cell' | 'other-text';
  optionIndex?: number;
  optionValue?: string;
  tableInfo?: { rowId: string; cellId: string; cellType: string };
}

interface CheckboxResult {
  varName: string;
  value: number | null;
}

/**
 * 옵션의 SPSS 숫자코드를 반환한다.
 * spssNumericCode가 있으면 사용, 없으면 1-based 인덱스 사용.
 */
function getNumericCode(options: QuestionOption[] | undefined, optionId: string): number | null {
  if (!options) return null;
  const idx = options.findIndex((o) => o.id === optionId || o.value === optionId);
  if (idx === -1) return null;
  const found = options[idx];
  if (!found) return null;
  return found.spssNumericCode ?? idx + 1;
}

/**
 * 단일선택(radio, select) 응답을 숫자코드로 변환한다.
 * hasOther 객체인 경우 selectedValue에서 숫자코드를 추출한다.
 */
export function transformSingleChoice(
  question: Question,
  value: string | { selectedValue: string; otherValue?: string; hasOther: true } | null | undefined,
): number | null {
  if (value == null) return null;
  const options = resolveChoiceOptions(question);
  if (typeof value === 'object' && 'hasOther' in value && value.hasOther) {
    return getNumericCode(options, value.selectedValue);
  }
  return getNumericCode(options, value as string);
}

/**
 * 복수선택(checkbox) 응답을 옵션별 독립 변수로 분리한다.
 * 선택된 옵션은 해당 숫자코드, 미선택은 null.
 */
export function transformCheckbox(
  question: Question,
  values: string[] | null | undefined,
): CheckboxResult[] {
  const options = resolveChoiceOptions(question);
  const selectedSet = new Set(values ?? []);

  return options.map((opt, idx) => {
    const code = opt.spssNumericCode ?? idx + 1;
    const isSelected = selectedSet.has(opt.id) || selectedSet.has(opt.value);
    return {
      varName: `${question.questionCode}_${opt.optionCode ?? String(idx + 1)}`,
      value: isSelected ? code : null,
    };
  });
}

/**
 * 텍스트(text, textarea) 응답을 그대로 반환한다.
 */
export function transformText(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  return value;
}

/**
 * 숫자 단답형(inputType==='number') 응답을 number|null 로 변환한다.
 * 빈값/비숫자는 null(system-missing), 실제 0 은 0 으로 보존.
 */
export function transformNumericText(value: unknown): number | null {
  if (value == null) return null;
  return parseNumericInput(String(value));
}

/**
 * 다단계 선택(multiselect) 응답을 밑줄로 합산한 텍스트로 반환한다.
 */
export function transformMultiselect(values: string[] | null | undefined): string | null {
  if (!values || values.length === 0) return null;
  return values.join('_');
}

/**
 * 기타(Other) 옵션의 텍스트를 추출한다.
 */
export function transformOtherOption(
  otherData: { hasOther?: boolean; otherValue?: string } | null | undefined,
): string | null {
  if (!otherData || !otherData.hasOther) return null;
  return otherData.otherValue ?? '';
}

/**
 * 순위형(ranking) 응답에서 특정 rank 의 선택된 옵션 숫자코드를 반환한다 (옵션 주입형).
 * - Case 1 (standalone): question.options 전달
 * - Case 2 (table source): resolveRankingOptions 결과 전달
 * - Case 3 (table cell-internal): cell.rankingOptions 전달
 * - 기타 선택(optionValue='__other__')은 Numeric 변수에서 system-missing (null).
 *   기타 텍스트는 `_etc` 문자열 변수에서 별도 저장.
 */
export function transformRankingWithOptions(
  options: QuestionOption[] | undefined,
  value: unknown,
  rank: number,
): number | null {
  if (!Array.isArray(value)) return null;
  const entry = (value as unknown[]).find(
    (a): a is RankingAnswer =>
      !!a && typeof a === 'object' && (a as RankingAnswer).rank === rank
        && typeof (a as RankingAnswer).optionValue === 'string',
  );
  if (!entry) return null;
  if (entry.optionValue === RANKING_OTHER_VALUE) return null;
  return getNumericCode(options, entry.optionValue);
}

/**
 * 순위형(ranking) 응답에서 특정 rank 의 기타 텍스트를 반환한다.
 * Case 1(질문 레벨) / Case 3(셀 레벨) 공통.
 */
export function transformRankingOtherText(
  value: unknown,
  rank: number,
): string | null {
  if (!Array.isArray(value)) return null;
  const entry = (value as unknown[]).find(
    (a): a is RankingAnswer =>
      !!a && typeof a === 'object' && (a as RankingAnswer).rank === rank,
  );
  if (!entry) return null;
  if (entry.optionValue !== RANKING_OTHER_VALUE) return null;
  const text = entry.otherText?.trim();
  return text && text.length > 0 ? text : null;
}

/**
 * 테이블 radio/select 셀 응답을 셀 옵션의 spssNumericCode로 변환한다.
 * 옵션이 없으면(자유 입력 등) 기존 transformTableCell 동작으로 폴백.
 */
export function transformTableChoiceCell(
  cellType: string,
  value: unknown,
  options: QuestionOption[] | undefined,
): string | number | null {
  if (value == null) return null;
  if ((cellType === 'radio' || cellType === 'select') && options && options.length > 0) {
    // 표 radio/select 응답은 optionId 문자열 또는 { optionId } 객체로 저장된다.
    // unwrapOptionId(table-cell-semantics SSOT)로 두 형태를 모두 언랩한 뒤 옵션 코드로 매핑한다.
    // 언랩 불가(레거시 number 등)면 기존 transformTableCell 폴백, 옵션에 없는 id면 null(system-missing).
    const optionId = unwrapOptionId(value);
    if (optionId === null) return transformTableCell(cellType, value);
    return getNumericCode(options, optionId);
  }
  return transformTableCell(cellType, value);
}

/**
 * 테이블 셀 값을 변환한다.
 */
export function transformTableCell(
  cellType: string,
  value: unknown,
): string | number | null {
  if (value == null) return null;

  switch (cellType) {
    case 'input':
      return typeof value === 'string' && value !== '' ? value : null;
    case 'checkbox':
    case 'radio':
    case 'select':
      return typeof value === 'number' ? value : typeof value === 'string' ? value : null;
    default:
      return null;
  }
}
