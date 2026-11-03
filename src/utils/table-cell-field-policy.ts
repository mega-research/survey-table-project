import type { TableCell } from '@/types/survey';

/**
 * 셀 필드 정책 (CONTEXT.md 「셀 필드 정책」) — `TableCell` 의 키마다 두 가지를 정한다.
 *
 * form — 셀 편집 폼(serialize-cell 의 buildUpdatedCell)이 그 키를 소유하는가
 *   - owned   저장 때 원본 값을 걷어내고 폼 값으로만 다시 쓴다. 폼에서 지운 값이 되살아나지 않는다.
 *   - kept    폼이 모르는 키라 원본 그대로 둔다.
 *   - dropped 폼이 다루지 않으면서 저장하면 늘 빠진다.
 * library — 셀 보관함(sanitizeCellForLibrary)에 싣는가
 *   - drop 은 위치·표 안 관계·설문 전역 이름처럼 다른 자리에 가면 뜻이 없거나 충돌하는 키다.
 *
 * 표의 타입이 `keyof TableCell` 전부를 요구하므로 새 필드를 여기 적지 않으면 tsc 가 막는다.
 * owned 로 적었다면 buildUpdatedCell 의 유형별 기록과 serialize-cell 테스트의 견본 셀에도
 * 넣어야 한다 — 견본이 빠지면 테스트가 실패한다.
 */
interface CellFieldPolicy {
  form: 'owned' | 'kept' | 'dropped';
  library: 'carry' | 'drop';
}

const OWNED = { form: 'owned', library: 'carry' } as const;
const OWNED_NOT_LIBRARY = { form: 'owned', library: 'drop' } as const;

export const TABLE_CELL_FIELD_POLICY = {
  id: { form: 'kept', library: 'drop' },
  type: OWNED,
  content: OWNED,
  contentHtml: OWNED,
  textBold: OWNED,
  boldFirstLine: OWNED,
  backgroundColor: OWNED,
  textColor: OWNED,
  // 셀 코드·엑셀 라벨은 표 위치에서 나온다
  cellCode: OWNED_NOT_LIBRARY,
  isCustomCellCode: OWNED_NOT_LIBRARY,
  exportLabel: OWNED_NOT_LIBRARY,
  isCustomExportLabel: OWNED_NOT_LIBRARY,
  hideRightBorder: OWNED,
  optionTextBelowTable: OWNED,
  choiceGroupId: OWNED,
  exclusiveChoice: OWNED,
  exclusiveScope: OWNED,
  excludeFromMean: OWNED,
  spssVarType: OWNED,
  spssMeasure: OWNED,
  spssNumericCode: OWNED,
  // 보기 칸 변수번호 — 폼에 칸이 없어 원본 그대로 두고, 문항 안 번호라 보관함에는 싣지 않는다
  optionCode: { form: 'kept', library: 'drop' },
  // 원본 이미지를 지우면 보관함 사본이 깨진다
  imageUrl: OWNED_NOT_LIBRARY,
  videoUrl: OWNED,
  checkboxOptions: OWNED,
  radioOptions: OWNED,
  // 라디오 그룹명·중복 불가 묶음은 그 표의 다른 칸과 맺은 관계다
  radioGroupName: OWNED_NOT_LIBRARY,
  distinctGroup: OWNED_NOT_LIBRARY,
  selectOptions: OWNED,
  allowOtherOption: OWNED,
  optionsColumns: OWNED,
  mobileOptionsColumns: OWNED,
  placeholder: OWNED,
  inputMaxLength: OWNED,
  inputRows: OWNED,
  inputAutoGrow: OWNED,
  inputWidth: OWNED,
  // 목록에서 찾기 — 설문 참조표와 같은 표의 칸을 가리켜 보관함에는 싣지 않는다
  lookupSearch: OWNED_NOT_LIBRARY,
  defaultValueTemplate: OWNED,
  prefillEditable: OWNED,
  inputType: OWNED,
  piiEncrypted: OWNED,
  emptyDefault: OWNED,
  numberFormat: OWNED,
  textValidation: OWNED,
  required: OWNED,
  requiredMessage: OWNED,
  minSelections: OWNED,
  maxSelections: OWNED,
  rankingConfig: OWNED,
  rankingOptions: OWNED,
  rankSuffixPattern: OWNED,
  // 순위별 수동 SPSS 변수명은 원본 칸 전용이라 다른 자리에서 충돌한다
  rankVarNames: OWNED_NOT_LIBRARY,
  rankingLabel: OWNED,
  isOtherRankingCell: OWNED,
  choiceLabel: OWNED,
  branchRule: OWNED,
  allowTextInput: OWNED,
  // 셀에는 쓰는 빌더 화면이 없다 — 폼 저장이 늘 걷어낸다
  textInputPlaceholder: { form: 'dropped', library: 'carry' },
  textInputType: OWNED,
  textInputNumberFormat: OWNED,
  rowspan: OWNED_NOT_LIBRARY,
  colspan: OWNED_NOT_LIBRARY,
  isHidden: { form: 'kept', library: 'drop' },
  horizontalAlign: OWNED,
  verticalAlign: OWNED,
  textPosition: OWNED,
  inputTextAlign: OWNED,
  mobileDisplay: OWNED,
  mobileLabel: OWNED,
  optionTextSlot: OWNED,
  // 렌더 전용 표식 — 저장된 셀에는 없다
  _isContinuation: { form: 'kept', library: 'drop' },
  _gridRowSpanExtra: { form: 'kept', library: 'drop' },
  // 응답 인용 이름은 설문 전역 식별자라 다른 자리에서 충돌한다
  answerQuoteEnabled: OWNED_NOT_LIBRARY,
  answerQuoteName: OWNED_NOT_LIBRARY,
  answerQuoteText: OWNED,
  formula: OWNED,
  formulaTolerance: OWNED,
  formulaErrorMessage: OWNED,
  calcValidation: OWNED,
  enabledWhen: OWNED,
  requiredWhenEnabled: OWNED,
} as const satisfies { [K in keyof TableCell]-?: CellFieldPolicy };

type Policy = typeof TABLE_CELL_FIELD_POLICY;

/** 셀 편집 저장이 원본에서 걷어내는 키 (owned + dropped) */
export type CellFormStrippedKey = {
  [K in keyof Policy]: Policy[K]['form'] extends 'kept' ? never : K;
}[keyof Policy];

/** 셀 보관함에 싣지 않는 키 */
export type CellLibraryDroppedKey = {
  [K in keyof Policy]: Policy[K]['library'] extends 'drop' ? K : never;
}[keyof Policy];

const POLICY_KEYS = Object.keys(TABLE_CELL_FIELD_POLICY) as (keyof Policy)[];

export const CELL_FORM_STRIPPED_KEYS = POLICY_KEYS.filter(
  (k) => TABLE_CELL_FIELD_POLICY[k].form !== 'kept',
) as readonly CellFormStrippedKey[];

export const CELL_FORM_OWNED_KEYS = POLICY_KEYS.filter(
  (k) => TABLE_CELL_FIELD_POLICY[k].form === 'owned',
) as readonly CellFormStrippedKey[];

export const CELL_LIBRARY_DROPPED_KEYS = POLICY_KEYS.filter(
  (k) => TABLE_CELL_FIELD_POLICY[k].library === 'drop',
) as readonly CellLibraryDroppedKey[];

/** 셀에서 주어진 키를 뺀 얕은 사본 */
export function omitCellKeys<K extends keyof TableCell>(
  cell: TableCell,
  keys: readonly K[],
): Omit<TableCell, K> {
  const copy: Partial<TableCell> = { ...cell };
  for (const key of keys) delete copy[key];
  return copy as Omit<TableCell, K>;
}
