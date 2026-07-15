import { describe, it, expect } from 'vitest';

import type { BranchRule, TableCell } from '@/types/survey';
import {
  buildUpdatedCell,
  cellToFormState,
  GROUPABLE_CELL_TYPES,
  type CellFormState,
  type ContentType,
} from '@/utils/serialize-cell';

// 기본 폼 상태 (cellToFormState 가 빈 셀에서 만드는 값과 동일).
// 각 테스트는 필요한 필드만 override 한다.
function baseForm(contentType: ContentType): CellFormState {
  const empty = cellToFormState({ id: 'c1', type: contentType, content: '' });
  return { ...empty, contentType };
}

const baseCell: TableCell = { id: 'c1', type: 'text', content: '' };

// baseForm 의 기본값(cellToFormState)은 isCustomCellCode/isCustomExportLabel 을 false 로 둔다.
// buildUpdatedCell 은 false 값을 명시적으로 키로 보존하므로(원본 handleSave 동작과 동일)
// exact-match 기대값에는 항상 이 두 키가 포함된다.
const CUSTOM_FALSE = { isCustomCellCode: false, isCustomExportLabel: false } as const;

describe('buildUpdatedCell — 셀타입별 characterization', () => {
  it('text: content 만 저장, optional 키는 모두 제거', () => {
    const form: CellFormState = { ...baseForm('text'), textContent: '안내 텍스트' };
    const out = buildUpdatedCell(form, baseCell);
    expect(out).toEqual({ id: 'c1', type: 'text', content: '안내 텍스트', ...CUSTOM_FALSE });
  });

  it('image: contentType=image 이고 imageUrl 있을 때만 imageUrl 저장', () => {
    const withUrl = buildUpdatedCell(
      { ...baseForm('image'), imageUrl: 'https://x/a.png' },
      baseCell,
    );
    expect(withUrl).toEqual({
      id: 'c1',
      type: 'image',
      content: '',
      imageUrl: 'https://x/a.png',
      ...CUSTOM_FALSE,
    });
    // imageUrl 비어있으면 키 제거
    const noUrl = buildUpdatedCell({ ...baseForm('image') }, baseCell);
    expect(noUrl).not.toHaveProperty('imageUrl');
  });

  it('video: contentType=video 이고 videoUrl 있을 때만 videoUrl 저장', () => {
    const out = buildUpdatedCell(
      { ...baseForm('video'), videoUrl: 'https://youtu.be/abc' },
      baseCell,
    );
    expect(out).toEqual({
      id: 'c1',
      type: 'video',
      content: '',
      videoUrl: 'https://youtu.be/abc',
      ...CUSTOM_FALSE,
    });
  });

  it('input: placeholder/maxLength/prefill/inputType + number 초기값', () => {
    const form: CellFormState = {
      ...baseForm('input'),
      inputPlaceholder: '이름',
      inputMaxLength: 20,
      inputDefaultValueTemplate: '  {{전시회명}}  ',
      inputType: 'number',
      emptyDefaultEnabled: true,
      emptyDefaultRaw: '5',
    };
    const out = buildUpdatedCell(form, baseCell);
    expect(out).toEqual({
      id: 'c1',
      type: 'input',
      content: '',
      placeholder: '이름',
      inputMaxLength: 20,
      defaultValueTemplate: '{{전시회명}}',
      inputType: 'number',
      emptyDefault: 5,
      ...CUSTOM_FALSE,
    });
  });

  it('input: text 모드면 emptyDefault 미저장, 빈 maxLength/placeholder 키 제거', () => {
    const form: CellFormState = {
      ...baseForm('input'),
      inputType: 'text',
      emptyDefaultEnabled: true,
      emptyDefaultRaw: '5',
      inputMaxLength: '',
    };
    const out = buildUpdatedCell(form, baseCell);
    expect(out).toEqual({
      id: 'c1',
      type: 'input',
      content: '',
      inputType: 'text',
      ...CUSTOM_FALSE,
    });
  });

  it('input: 기존 숫자/초기값/prefill/placeholder/maxLength 를 비우거나 기본값으로 돌리면 제거한다', () => {
    const existingInput: TableCell = {
      id: 'input1',
      type: 'input',
      content: '',
      placeholder: '기존 안내',
      inputMaxLength: 20,
      defaultValueTemplate: '{{기존}}',
      inputType: 'number',
      emptyDefault: 0,
    };

    const out = buildUpdatedCell(baseForm('input'), existingInput);

    expect(out.inputType).toBe('text');
    expect(out).not.toHaveProperty('placeholder');
    expect(out).not.toHaveProperty('inputMaxLength');
    expect(out).not.toHaveProperty('defaultValueTemplate');
    expect(out).not.toHaveProperty('emptyDefault');
  });

  it('input: 기존 숫자 초기값을 수정하면 새 값으로 덮어쓴다', () => {
    const out = buildUpdatedCell(
      {
        ...baseForm('input'),
        inputType: 'number',
        emptyDefaultEnabled: true,
        emptyDefaultRaw: '7',
      },
      { id: 'input1', type: 'input', content: '', inputType: 'number', emptyDefault: 0 },
    );

    expect(out.emptyDefault).toBe(7);
  });

  it('input: numberFormat 은 inputType=number 이고 폼에 값이 있을 때만 저장된다', () => {
    const nf = { thousandSeparator: true, unit: 'tenThousand' as const, min: 0, max: 100 };
    const numberMode = buildUpdatedCell(
      { ...baseForm('input'), inputType: 'number', cellNumberFormat: nf },
      baseCell,
    );
    expect(numberMode.numberFormat).toEqual(nf);

    // text 모드면 폼에 값이 남아있어도 저장하지 않는다 (numberFormat 은 숫자 모드 전용).
    const textMode = buildUpdatedCell(
      { ...baseForm('input'), inputType: 'text', cellNumberFormat: nf },
      baseCell,
    );
    expect(textMode).not.toHaveProperty('numberFormat');
  });

  it('input: 기존 numberFormat 을 폼에서 비우면 제거된다 (cellBase 스테일 값 방지)', () => {
    const existing: TableCell = {
      id: 'input1',
      type: 'input',
      content: '',
      inputType: 'number',
      numberFormat: { thousandSeparator: true },
    };
    const out = buildUpdatedCell(
      { ...baseForm('input'), inputType: 'number', cellNumberFormat: undefined },
      existing,
    );
    expect(out).not.toHaveProperty('numberFormat');
  });

  it('input: inputRequired 체크 시 required=true 저장 (inputType 무관)', () => {
    const out = buildUpdatedCell(
      { ...baseForm('input'), inputType: 'text', inputRequired: true },
      baseCell,
    );
    expect(out.required).toBe(true);
  });

  it('input: 기존 required 를 폼에서 해제하면 제거된다 (cellBase 스테일 값 방지)', () => {
    const existing: TableCell = {
      id: 'input1',
      type: 'input',
      content: '',
      inputType: 'text',
      required: true,
    };
    const out = buildUpdatedCell(
      { ...baseForm('input'), inputType: 'text', inputRequired: false },
      existing,
    );
    expect(out).not.toHaveProperty('required');
  });

  it('checkbox: checkboxOptions + allowOtherOption + optionsColumns + min/max', () => {
    const form: CellFormState = {
      ...baseForm('checkbox'),
      checkboxOptions: [{ id: 'o1', label: 'A', value: 'a' }],
      allowOtherOption: true,
      cellOptionsColumns: 2,
      minSelections: 1,
      maxSelections: 3,
    };
    const out = buildUpdatedCell(form, baseCell);
    expect(out).toEqual({
      id: 'c1',
      type: 'checkbox',
      content: '',
      checkboxOptions: [{ id: 'o1', label: 'A', value: 'a' }],
      allowOtherOption: true,
      optionsColumns: 2,
      minSelections: 1,
      maxSelections: 3,
      ...CUSTOM_FALSE,
    });
  });

  it('radio: radioOptions + radioGroupName + allowOtherOption', () => {
    const form: CellFormState = {
      ...baseForm('radio'),
      radioOptions: [{ id: 'r1', label: '예', value: 'y' }],
      radioGroupName: 'grp',
      allowOtherOption: false,
    };
    const out = buildUpdatedCell(form, baseCell);
    expect(out).toEqual({
      id: 'c1',
      type: 'radio',
      content: '',
      radioOptions: [{ id: 'r1', label: '예', value: 'y' }],
      radioGroupName: 'grp',
      allowOtherOption: false,
      ...CUSTOM_FALSE,
    });
    // min/max 는 radio 에서 저장 안 함
    expect(out).not.toHaveProperty('minSelections');
  });

  it('select: selectOptions + allowOtherOption', () => {
    const form: CellFormState = {
      ...baseForm('select'),
      selectOptions: [{ id: 's1', label: '서울', value: 'seoul' }],
    };
    const out = buildUpdatedCell(form, baseCell);
    expect(out).toEqual({
      id: 'c1',
      type: 'select',
      content: '',
      selectOptions: [{ id: 's1', label: '서울', value: 'seoul' }],
      allowOtherOption: false,
      ...CUSTOM_FALSE,
    });
  });

  it('ranking: rankingOptions + config + suffix + trimmed varNames(positions 컷)', () => {
    const form: CellFormState = {
      ...baseForm('ranking'),
      rankingOptions: [{ id: 'o1', label: '옵션1', value: 'opt1' }],
      rankingConfig: { positions: 2 },
      rankSuffixPattern: '  _rnk{k}  ',
      rankVarNames: ['v1', '', 'v3'],
      allowOtherOption: true,
      cellOptionsColumns: 3,
    };
    const out = buildUpdatedCell(form, baseCell);
    expect(out).toEqual({
      id: 'c1',
      type: 'ranking',
      content: '',
      rankingOptions: [{ id: 'o1', label: '옵션1', value: 'opt1' }],
      rankingConfig: { positions: 2 },
      rankSuffixPattern: '_rnk{k}',
      // positions=2 로 slice → ['v1',''] → trim → some(len>0)=true 이므로 저장
      rankVarNames: ['v1', ''],
      allowOtherOption: true,
      optionsColumns: 3,
      ...CUSTOM_FALSE,
    });
  });

  it('ranking: 모든 varName 이 공백이면 rankVarNames 키 제거', () => {
    const form: CellFormState = {
      ...baseForm('ranking'),
      rankingOptions: [{ id: 'o1', label: 'A', value: 'a' }],
      rankingConfig: { positions: 3 },
      rankVarNames: ['', '   ', ''],
    };
    const out = buildUpdatedCell(form, baseCell);
    expect(out).not.toHaveProperty('rankVarNames');
  });

  it('타입별 optional 값은 폼에서 비우면 기존 셀 값도 제거한다', () => {
    const image = buildUpdatedCell(
      baseForm('image'),
      { id: 'img1', type: 'image', content: '', imageUrl: 'https://x/old.png' },
    );
    expect(image).not.toHaveProperty('imageUrl');

    const checkbox = buildUpdatedCell(
      {
        ...baseForm('checkbox'),
        checkboxOptions: [],
        allowOtherOption: false,
        cellOptionsColumns: undefined,
        minSelections: undefined,
        maxSelections: undefined,
      },
      {
        id: 'cb1',
        type: 'checkbox',
        content: '',
        checkboxOptions: [{ id: 'a', label: 'A', value: 'a' }],
        allowOtherOption: true,
        optionsColumns: 2,
        minSelections: 1,
        maxSelections: 2,
      },
    );
    expect(checkbox.checkboxOptions).toEqual([]);
    expect(checkbox.allowOtherOption).toBe(false);
    expect(checkbox).not.toHaveProperty('optionsColumns');
    expect(checkbox).not.toHaveProperty('minSelections');
    expect(checkbox).not.toHaveProperty('maxSelections');

    const ranking = buildUpdatedCell(
      {
        ...baseForm('ranking'),
        rankingOptions: [],
        rankingConfig: undefined,
        rankSuffixPattern: '',
        rankVarNames: ['', ''],
      },
      {
        id: 'rk1',
        type: 'ranking',
        content: '',
        rankingOptions: [{ id: 'a', label: 'A', value: 'a' }],
        rankingConfig: { positions: 2 },
        rankSuffixPattern: '_old{k}',
        rankVarNames: ['old1', 'old2'],
      },
    );
    expect(ranking.rankingOptions).toEqual([]);
    expect(ranking).not.toHaveProperty('rankingConfig');
    expect(ranking).not.toHaveProperty('rankSuffixPattern');
    expect(ranking).not.toHaveProperty('rankVarNames');
  });

  it('ranking_opt: rankingLabel + spssNumericCode (비-기타)', () => {
    const form: CellFormState = {
      ...baseForm('ranking_opt'),
      rankingLabel: '  라벨  ',
      cellSpssNumericCode: 7,
      isOtherRankingCell: false,
    };
    const out = buildUpdatedCell(form, baseCell);
    expect(out).toEqual({
      id: 'c1',
      type: 'ranking_opt',
      content: '',
      rankingLabel: '라벨',
      spssNumericCode: 7,
      ...CUSTOM_FALSE,
    });
  });

  it('ranking_opt: 기타 모드면 isOtherRankingCell=true, spssNumericCode 강제 제거', () => {
    const form: CellFormState = {
      ...baseForm('ranking_opt'),
      cellSpssNumericCode: 7,
      isOtherRankingCell: true,
    };
    const out = buildUpdatedCell(form, baseCell);
    expect(out).toEqual({
      id: 'c1',
      type: 'ranking_opt',
      content: '',
      isOtherRankingCell: true,
      ...CUSTOM_FALSE,
    });
    expect(out).not.toHaveProperty('spssNumericCode');
  });

  it('ranking_opt: choiceGroupId 설정 시 저장되고 해제(빈 문자열) 시 키가 제거된다', () => {
    const cellWithGroup: TableCell = { id: 'c1', type: 'ranking_opt', content: '', choiceGroupId: 'rg1' };

    // 그룹 설정: choiceGroupId='rg1'
    const formSet: CellFormState = { ...baseForm('ranking_opt'), choiceGroupId: 'rg1' };
    const outSet = buildUpdatedCell(formSet, baseCell);
    expect(outSet.choiceGroupId).toBe('rg1');

    // 그룹 해제: choiceGroupId='' — 기존 셀에 choiceGroupId 가 있어도 키가 제거되어야 한다
    const formRelease: CellFormState = { ...baseForm('ranking_opt'), choiceGroupId: '' };
    const outRelease = buildUpdatedCell(formRelease, cellWithGroup);
    expect(outRelease).not.toHaveProperty('choiceGroupId');
  });

  it('choice_opt: choiceGroupId 설정·해제가 ranking_opt 경로에 영향을 주지 않는다 (회귀)', () => {
    // choice_opt 기존 케이스 불변 확인
    const cellWithGroup: TableCell = { id: 'c1', type: 'choice_opt', content: '', choiceGroupId: 'g1' };
    const formSet: CellFormState = { ...baseForm('choice_opt'), choiceGroupId: 'g1' };
    const outSet = buildUpdatedCell(formSet, baseCell);
    expect(outSet.choiceGroupId).toBe('g1');

    const formRelease: CellFormState = { ...baseForm('choice_opt'), choiceGroupId: '' };
    const outRelease = buildUpdatedCell(formRelease, cellWithGroup);
    expect(outRelease).not.toHaveProperty('choiceGroupId');

    // ranking_opt 그룹 설정 시 choice_opt 전용 필드(choiceLabel 등)는 섞이지 않아야 한다
    const formRnk: CellFormState = { ...baseForm('ranking_opt'), choiceGroupId: 'rg1' };
    const outRnk = buildUpdatedCell(formRnk, baseCell);
    expect(outRnk).not.toHaveProperty('choiceLabel');
    expect(outRnk).not.toHaveProperty('allowTextInput');
    expect(outRnk).not.toHaveProperty('branchRule');
  });

  it('choice_opt: choiceLabel + allowTextInput + branchRule(value=cell.id 강제) + spssNumericCode', () => {
    const branch: BranchRule = {
      id: 'b1',
      value: 'WRONG',
      action: 'goto',
      targetQuestionId: 'q9',
    };
    const form: CellFormState = {
      ...baseForm('choice_opt'),
      choiceLabel: 'UHD',
      choiceAllowTextInput: true,
      choiceBranchRule: branch,
      cellSpssNumericCode: 3,
    };
    const out = buildUpdatedCell(form, baseCell);
    expect(out.type).toBe('choice_opt');
    expect(out.choiceLabel).toBe('UHD');
    expect(out.allowTextInput).toBe(true);
    expect(out.spssNumericCode).toBe(3);
    // branchRule.value 는 cell.id 로 강제 교체
    expect(out.branchRule).toEqual({ ...branch, value: 'c1' });
  });

  it('옵션 소스 optional 값은 폼에서 비우면 기존 셀 값도 제거한다', () => {
    const choice = buildUpdatedCell(
      {
        ...baseForm('choice_opt'),
        choiceLabel: '',
        choiceAllowTextInput: false,
        choiceBranchRule: undefined,
        cellSpssNumericCode: '',
      },
      {
        id: 'choice1',
        type: 'choice_opt',
        content: '',
        choiceLabel: '기존 라벨',
        allowTextInput: true,
        branchRule: { id: 'b1', value: 'choice1', action: 'goto', targetQuestionId: 'q2' },
        spssNumericCode: 9,
      },
    );
    expect(choice).not.toHaveProperty('choiceLabel');
    expect(choice).not.toHaveProperty('allowTextInput');
    expect(choice).not.toHaveProperty('branchRule');
    expect(choice).not.toHaveProperty('spssNumericCode');

    const rankingOpt = buildUpdatedCell(
      {
        ...baseForm('ranking_opt'),
        rankingLabel: '',
        isOtherRankingCell: false,
        cellSpssNumericCode: '',
      },
      {
        id: 'rankOpt1',
        type: 'ranking_opt',
        content: '',
        rankingLabel: '기존 라벨',
        isOtherRankingCell: true,
        spssNumericCode: 3,
      },
    );
    expect(rankingOpt).not.toHaveProperty('rankingLabel');
    expect(rankingOpt).not.toHaveProperty('isOtherRankingCell');
    expect(rankingOpt).not.toHaveProperty('spssNumericCode');
  });

  it('choice_opt: choiceGroupId 설정 시 저장되고 해제(빈 문자열) 시 키가 제거된다', () => {
    const cellWithGroup: TableCell = { id: 'c1', type: 'choice_opt', content: '', choiceGroupId: 'g1' };

    // 그룹 설정: choiceGroupId='g1'
    const formSet: CellFormState = { ...baseForm('choice_opt'), choiceGroupId: 'g1' };
    const outSet = buildUpdatedCell(formSet, baseCell);
    expect(outSet.choiceGroupId).toBe('g1');

    // 그룹 해제: choiceGroupId='' — 기존 셀에 choiceGroupId 가 있어도 키가 제거되어야 한다
    const formRelease: CellFormState = { ...baseForm('choice_opt'), choiceGroupId: '' };
    const outRelease = buildUpdatedCell(formRelease, cellWithGroup);
    expect(outRelease).not.toHaveProperty('choiceGroupId');
  });

  it('병합/정렬/textPosition/코드/라벨: 기본값은 키 제거, 비기본값만 저장', () => {
    const form: CellFormState = {
      ...baseForm('input'),
      isMergeEnabled: true,
      rowspan: 2,
      colspan: 1,
      horizontalAlign: 'center',
      verticalAlign: 'bottom',
      textPosition: 'left',
      cellCode: 'Q1_r1_c1',
      isCustomCellCode: true,
      exportLabel: '라벨',
      isCustomExportLabel: false,
      spssVarType: 'Numeric',
      spssMeasure: 'Nominal',
    };
    const out = buildUpdatedCell(form, baseCell);
    expect(out.rowspan).toBe(2);
    expect(out).not.toHaveProperty('colspan'); // colspan=1 은 저장 안 함
    expect(out.horizontalAlign).toBe('center');
    expect(out.verticalAlign).toBe('bottom');
    expect(out.textPosition).toBe('left');
    expect(out.cellCode).toBe('Q1_r1_c1');
    expect(out.isCustomCellCode).toBe(true);
    expect(out.exportLabel).toBe('라벨');
    expect(out.isCustomExportLabel).toBe(false);
    expect(out.spssVarType).toBe('Numeric');
    expect(out.spssMeasure).toBe('Nominal');
  });

  it('정렬/textPosition: 기존 비기본값을 기본값으로 되돌리면 저장값에서 제거한다', () => {
    const cellWithAlignment: TableCell = {
      id: 'c1',
      type: 'input',
      content: '',
      horizontalAlign: 'right',
      verticalAlign: 'bottom',
      textPosition: 'left',
    };

    const out = buildUpdatedCell(baseForm('input'), cellWithAlignment);

    expect(out).not.toHaveProperty('horizontalAlign');
    expect(out).not.toHaveProperty('verticalAlign');
    expect(out).not.toHaveProperty('textPosition');
  });

  it('코드/엑셀라벨/병합도 기본값으로 되돌리면 기존 값을 제거한다', () => {
    const out = buildUpdatedCell(
      baseForm('input'),
      {
        id: 'c1',
        type: 'input',
        content: '',
        rowspan: 2,
        colspan: 2,
        cellCode: 'OLD_CODE',
        isCustomCellCode: true,
        exportLabel: 'OLD_LABEL',
        isCustomExportLabel: true,
      },
    );

    expect(out).not.toHaveProperty('rowspan');
    expect(out).not.toHaveProperty('colspan');
    expect(out).not.toHaveProperty('cellCode');
    expect(out.isCustomCellCode).toBe(false);
    expect(out).not.toHaveProperty('exportLabel');
    expect(out.isCustomExportLabel).toBe(false);
  });

  it('textInputPlaceholder 는 항상 베이스에서 제거된다 (choice_opt 전환 클리어)', () => {
    const cellWithPlaceholder: TableCell = {
      id: 'c1',
      type: 'choice_opt',
      content: '',
      textInputPlaceholder: '상세 기재',
    };
    const out = buildUpdatedCell({ ...baseForm('text'), textContent: 'x' }, cellWithPlaceholder);
    expect(out).not.toHaveProperty('textInputPlaceholder');
  });

  it('mobileDisplay: text/image/video 셀이고 hidden 이 아닐 때만 새로 저장', () => {
    const shown = buildUpdatedCell(
      { ...baseForm('text'), mobileDisplay: 'header' },
      baseCell,
    );
    expect(shown.mobileDisplay).toBe('header');
    // input 셀의 label visible 상태는 기본값이므로 저장 대상 아님
    const input = buildUpdatedCell(
      { ...baseForm('input'), mobileDisplay: 'inline' },
      baseCell,
    );
    expect(input).not.toHaveProperty('mobileDisplay');
    // hidden 은 저장 안 함
    const hidden = buildUpdatedCell({ ...baseForm('text'), mobileDisplay: 'hidden' }, baseCell);
    expect(hidden).not.toHaveProperty('mobileDisplay');
  });

  it('mobileDisplay: 기존 표시 셀을 hidden 으로 바꾸면 명시 hidden 으로 저장한다', () => {
    const cellWithMobileDisplay: TableCell = {
      ...baseCell,
      mobileDisplay: 'header',
    };

    const out = buildUpdatedCell(
      { ...baseForm('text'), mobileDisplay: 'hidden' },
      cellWithMobileDisplay,
    );

    expect(out.mobileDisplay).toBe('hidden');
  });

  it('mobileDisplay: 인터랙티브 셀 라벨 숨김은 hidden 으로 저장한다', () => {
    const out = buildUpdatedCell(
      { ...baseForm('input'), mobileDisplay: 'hidden' },
      { id: 'input1', type: 'input', content: '', exportLabel: '설립연도_년' },
    );

    expect(out.mobileDisplay).toBe('hidden');
  });
});

describe('GROUPABLE_CELL_TYPES', () => {
  it('choice_opt 와 ranking_opt 를 포함하고 다른 타입은 포함하지 않는다', () => {
    expect(GROUPABLE_CELL_TYPES.has('choice_opt')).toBe(true);
    expect(GROUPABLE_CELL_TYPES.has('ranking_opt')).toBe(true);

    const notGroupable: TableCell['type'][] = ['text', 'image', 'video', 'input', 'checkbox', 'radio', 'select', 'ranking'];
    for (const t of notGroupable) {
      expect(GROUPABLE_CELL_TYPES.has(t)).toBe(false);
    }
  });
});

describe('cellToFormState — 라운드트립', () => {
  it('인터랙티브 셀의 모바일 라벨은 기본 표시 상태로 hydrate 된다', () => {
    const form = cellToFormState({ id: 'input1', type: 'input', content: '' });

    expect(form.mobileDisplay).toBe('inline');
  });

  it('비어있지 않은 셀을 폼으로 변환 후 직렬화하면 핵심 필드가 보존된다', () => {
    const cell: TableCell = {
      id: 'c9',
      type: 'checkbox',
      content: '설명',
      checkboxOptions: [{ id: 'o1', label: 'A', value: 'a' }],
      allowOtherOption: true,
      optionsColumns: 2,
      minSelections: 1,
      maxSelections: 2,
      horizontalAlign: 'center',
    };
    const form = cellToFormState(cell);
    const out = buildUpdatedCell(form, cell);
    expect(out.type).toBe('checkbox');
    expect(out.content).toBe('설명');
    expect(out.checkboxOptions).toEqual([{ id: 'o1', label: 'A', value: 'a' }]);
    expect(out.allowOtherOption).toBe(true);
    expect(out.optionsColumns).toBe(2);
    expect(out.minSelections).toBe(1);
    expect(out.maxSelections).toBe(2);
    expect(out.horizontalAlign).toBe('center');
  });

  it('numberFormat/required 를 가진 숫자 input 셀은 폼 왕복 후에도 값이 보존된다', () => {
    const cell: TableCell = {
      id: 'c10',
      type: 'input',
      content: '',
      inputType: 'number',
      numberFormat: { thousandSeparator: true, unit: 'percent', min: 0, max: 100 },
      required: true,
    };
    const form = cellToFormState(cell);
    expect(form.cellNumberFormat).toEqual(cell.numberFormat);
    expect(form.inputRequired).toBe(true);

    const out = buildUpdatedCell(form, cell);
    expect(out.numberFormat).toEqual(cell.numberFormat);
    expect(out.required).toBe(true);
  });
});
