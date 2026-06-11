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

  it('mobileDisplay: text/image/video 셀이고 hidden 이 아닐 때만 저장', () => {
    const shown = buildUpdatedCell(
      { ...baseForm('text'), mobileDisplay: 'header' },
      baseCell,
    );
    expect(shown.mobileDisplay).toBe('header');
    // input 셀은 mobileDisplay 저장 대상 아님
    const input = buildUpdatedCell(
      { ...baseForm('input'), mobileDisplay: 'inline' },
      baseCell,
    );
    expect(input).not.toHaveProperty('mobileDisplay');
    // hidden 은 저장 안 함
    const hidden = buildUpdatedCell({ ...baseForm('text'), mobileDisplay: 'hidden' }, baseCell);
    expect(hidden).not.toHaveProperty('mobileDisplay');
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
});
