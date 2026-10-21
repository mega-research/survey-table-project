import { describe, expect, it } from 'vitest';

import {
  MOBILE_DISPLAY_CELL_TYPES,
  buildUpdatedCell,
  cellToFormState,
} from '@/features/survey-builder/table-editor/cell-editor/utils/serialize-cell';
import type { TableCell } from '@/types/survey';
import { CELL_FORM_OWNED_KEYS } from '@/utils/table-cell-field-policy';

/**
 * 셀 필드 정책(CONTEXT.md)의 폼 쪽 계약.
 *
 * 견본 셀은 유형마다 폼이 소유하는 키를 뜻 있는 값으로 채운 것이다. 폼으로 읽었다가 그대로
 * 저장하면 같은 셀이 나와야 하고(hydrate·유형별 기록 누락을 잡는다), 견본 전체가 폼 소유 키를
 * 빠짐없이 덮어야 한다(새 필드를 정책에 owned 로 적고 견본을 안 넣으면 여기서 실패한다).
 *
 * 견본은 저장 결과의 정규형으로 적는다 — 셀 코드 수동 여부·라디오 그룹명·기타 허용·입력 모드처럼
 * 저장이 늘 키를 쓰는 필드는 값을 명시한다.
 */
const CODE = { isCustomCellCode: false, isCustomExportLabel: false } as const;

const SAMPLES: Record<string, TableCell> = {
  text: {
    id: 'c1',
    type: 'text',
    content: '굵게 평문',
    contentHtml: '<p><strong>굵게</strong> 평문</p>',
    textBold: true,
    backgroundColor: '#eeeeee',
    textColor: '#333333',
    horizontalAlign: 'center',
    verticalAlign: 'middle',
    mobileDisplay: 'collapsed',
    optionTextSlot: true,
    rowspan: 2,
    colspan: 3,
    hideRightBorder: true,
    cellCode: 'Q1_r1_c1',
    isCustomCellCode: true,
    exportLabel: '라벨',
    isCustomExportLabel: true,
  },
  image: {
    id: 'c1',
    type: 'image',
    content: '',
    imageUrl: 'https://example.com/a.png',
    boldFirstLine: true,
    mobileDisplay: 'hidden',
    ...CODE,
  },
  video: {
    id: 'c1',
    type: 'video',
    content: '',
    videoUrl: 'https://example.com/v',
    mobileDisplay: 'header',
    ...CODE,
  },
  checkbox: {
    id: 'c1',
    type: 'checkbox',
    content: '설명',
    checkboxOptions: [{ id: 'o1', label: '보기', value: '1' }],
    allowOtherOption: true,
    optionsColumns: 2,
    mobileOptionsColumns: 1,
    minSelections: 1,
    maxSelections: 3,
    required: true,
    requiredMessage: '골라 주세요',
    optionTextBelowTable: true,
    textPosition: 'left',
    mobileLabel: '모바일 라벨',
    mobileDisplay: 'hidden',
    spssVarType: 'Numeric',
    spssMeasure: 'Nominal',
    answerQuoteEnabled: true,
    answerQuoteName: '인용',
    ...CODE,
  },
  radioGated: {
    id: 'c1',
    type: 'radio',
    content: '',
    radioOptions: [{ id: 'o1', label: '예', value: '1' }],
    radioGroupName: 'g1',
    allowOtherOption: false,
    enabledWhen: { kind: 'filled', controllerCellId: 'c0' },
    requiredWhenEnabled: true,
    requiredMessage: '활성이면 필수',
    ...CODE,
  },
  select: {
    id: 'c1',
    type: 'select',
    content: '',
    selectOptions: [{ id: 'o1', label: '서울', value: '1' }],
    allowOtherOption: false,
    distinctGroup: '지역',
    ...CODE,
  },
  inputText: {
    id: 'c1',
    type: 'input',
    content: '',
    placeholder: '입력',
    inputMaxLength: 10,
    inputRows: 3,
    inputAutoGrow: true,
    inputWidth: 120,
    defaultValueTemplate: '{{회사명}}',
    prefillEditable: true,
    inputType: 'text',
    piiEncrypted: true,
    textValidation: { minLength: 2, rejectMeaningless: true },
    lookupSearch: {
      lookupId: 'lut-1',
      labelColumn: '기업명',
      fills: [{ column: '사업자등록번호', cellId: 'c9' }],
    },
    inputTextAlign: 'right',
    answerQuoteText: '인용 문구',
    ...CODE,
  },
  inputNumber: {
    id: 'c1',
    type: 'input',
    content: '',
    inputType: 'number',
    emptyDefault: 0,
    numberFormat: { thousandSeparator: true, max: 100 },
    formula: { kind: 'cell', cellId: 'c9' },
    formulaTolerance: 1,
    formulaErrorMessage: '합이 맞지 않습니다',
    ...CODE,
  },
  ranking: {
    id: 'c1',
    type: 'ranking',
    content: '',
    rankingOptions: [{ id: 'o1', label: '가', value: '1' }],
    rankingConfig: { positions: 2 },
    rankSuffixPattern: '_r{k}',
    rankVarNames: ['a1', 'a2'],
    allowOtherOption: false,
    ...CODE,
  },
  rankingOpt: {
    id: 'c1',
    type: 'ranking_opt',
    content: '',
    rankingLabel: '보기 가',
    choiceGroupId: 'grp',
    spssNumericCode: 3,
    allowTextInput: true,
    ...CODE,
  },
  rankingOptOther: {
    id: 'c1',
    type: 'ranking_opt',
    content: '',
    isOtherRankingCell: true,
    ...CODE,
  },
  choiceOpt: {
    id: 'c1',
    type: 'choice_opt',
    content: '',
    choiceLabel: '없음',
    allowTextInput: true,
    exclusiveChoice: true,
    exclusiveScope: 'table',
    textInputType: 'number',
    textInputNumberFormat: { decimalPlaces: 0 },
    branchRule: { id: 'b1', value: 'c1', action: 'end' },
    choiceGroupId: 'grp',
    spssNumericCode: 9,
    ...CODE,
  },
  calc: {
    id: 'c1',
    type: 'calc',
    content: '합계',
    formula: { kind: 'agg', fn: 'sum', items: [{ kind: 'cell', cellId: 'c2' }] },
    numberFormat: { decimalPlaces: 1 },
    calcValidation: {
      operator: 'eq',
      target: { kind: 'literal', value: 100 },
      tolerance: 0.5,
      errorMessage: '100 이어야 합니다',
    },
    ...CODE,
  },
};

describe('셀 필드 정책 — 셀 편집 폼 왕복', () => {
  it.each(Object.entries(SAMPLES))('%s: 폼으로 읽었다가 그대로 저장하면 같은 셀이다', (_, cell) => {
    expect(buildUpdatedCell(cellToFormState(cell), cell)).toEqual(cell);
  });

  it('견본이 폼 소유 키를 빠짐없이 덮는다', () => {
    const covered = new Set(Object.values(SAMPLES).flatMap((cell) => Object.keys(cell)));
    const missing = CELL_FORM_OWNED_KEYS.filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(SAMPLES))(
    '%s: 빈 폼으로 저장하면 원본 값이 되살아나지 않는다',
    (_, cell) => {
      const blank: TableCell = { id: cell.id, type: cell.type, content: '' };
      const form = cellToFormState(blank);
      // 원본을 보는 유일한 규칙 — 모바일 표시를 명시했던 표시 셀을 숨김으로 돌리면 hidden 을 명시로 남긴다
      const explicitHidden =
        MOBILE_DISPLAY_CELL_TYPES.has(cell.type) && cell.mobileDisplay !== undefined
          ? { mobileDisplay: 'hidden' as const }
          : {};
      expect(buildUpdatedCell(form, cell)).toEqual({
        ...buildUpdatedCell(form, blank),
        ...explicitHidden,
      });
    },
  );
});
