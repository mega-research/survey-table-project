import { describe, expect, it } from 'vitest';
import {
  migrateQuestionOptions,
  migrateResponseValue,
  migrateSnapshotQuestions,
  generateOtherOptionFields,
  type LegacyQuestionShape,
  type LegacyResponseShape,
} from '@/lib/option-text-migration';

describe('migrateQuestionOptions', () => {
  it('appends 기타 option when allowOtherOption=true and 5 options exist', () => {
    const question: LegacyQuestionShape = {
      id: 'q1',
      allowOtherOption: true,
      options: [
        { id: 'o1', label: '선택1', value: '1', optionCode: '1', spssNumericCode: 1 },
        { id: 'o2', label: '선택2', value: '2', optionCode: '2', spssNumericCode: 2 },
        { id: 'o3', label: '선택3', value: '3', optionCode: '3', spssNumericCode: 3 },
        { id: 'o4', label: '선택4', value: '4', optionCode: '4', spssNumericCode: 4 },
        { id: 'o5', label: '선택5', value: '5', optionCode: '5', spssNumericCode: 5 },
      ],
    };

    const result = migrateQuestionOptions(question);

    expect(result.allowOtherOption).toBeUndefined();
    expect(result.options).toHaveLength(6);
    expect(result.options![5]).toMatchObject({
      label: '기타',
      allowTextInput: true,
      optionCode: '6',
      spssNumericCode: 6,
    });
    expect(result.options![5].id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(result.migratedOtherOptionId).toBe(result.options![5].id);
  });

  it('zero-pads optionCode when total options >= 10', () => {
    const question: LegacyQuestionShape = {
      id: 'q2',
      allowOtherOption: true,
      options: Array.from({ length: 10 }, (_, i) => ({
        id: `o${i + 1}`,
        label: `선택${i + 1}`,
        value: String(i + 1),
        optionCode: String(i + 1).padStart(2, '0'),
        spssNumericCode: i + 1,
      })),
    };

    const result = migrateQuestionOptions(question);

    expect(result.options).toHaveLength(11);
    expect(result.options![10].optionCode).toBe('11');
    expect(result.options![10].spssNumericCode).toBe(11);
  });

  it('does not modify questions without allowOtherOption', () => {
    const question: LegacyQuestionShape = {
      id: 'q3',
      allowOtherOption: false,
      options: [
        { id: 'o1', label: '선택1', value: '1', optionCode: '1', spssNumericCode: 1 },
      ],
    };

    const result = migrateQuestionOptions(question);

    expect(result.options).toHaveLength(1);
    expect(result.migratedOtherOptionId).toBeNull();
  });

  it('is idempotent — running twice produces same shape', () => {
    const question: LegacyQuestionShape = {
      id: 'q4',
      allowOtherOption: true,
      options: [{ id: 'o1', label: '선택1', value: '1', optionCode: '1', spssNumericCode: 1 }],
    };

    const first = migrateQuestionOptions(question);
    const second = migrateQuestionOptions({ ...first, allowOtherOption: undefined });

    expect(second.options).toHaveLength(first.options!.length);
    expect(second.migratedOtherOptionId).toBeNull();
  });

  it('handles empty options array with allowOtherOption=true', () => {
    const question: LegacyQuestionShape = {
      id: 'q_empty',
      allowOtherOption: true,
      options: [],
    };

    const result = migrateQuestionOptions(question);

    expect(result.options).toHaveLength(1);
    expect(result.options![0]).toMatchObject({
      label: '기타',
      allowTextInput: true,
      optionCode: '1',
      spssNumericCode: 1,
    });
    expect(result.migratedOtherOptionId).toBe(result.options![0].id);
  });

  it('preserves ID stability when called twice — does not re-append', () => {
    const question: LegacyQuestionShape = {
      id: 'q_idempotent',
      allowOtherOption: true,
      options: [{ id: 'o1', label: '선택1', value: '1', optionCode: '1', spssNumericCode: 1 }],
    };

    const first = migrateQuestionOptions(question);
    const otherOptionId = first.options![1].id;

    // 두 번째 호출 -- 이미 마이그레이션된 결과 (allowOtherOption 없음) 를 그대로 줌
    const second = migrateQuestionOptions({ ...first, allowOtherOption: undefined });

    expect(second.options).toHaveLength(2);
    expect(second.options![1].id).toBe(otherOptionId);
    expect(second.options![1].allowTextInput).toBe(true);
  });
});

describe('migrateResponseValue', () => {
  it('converts otherInputs[] to optionTexts map when matching optionId provided', () => {
    const legacyResponse: LegacyResponseShape = {
      questionId: 'q1',
      value: ['o4', '__other__'],
      otherInputs: [{ optionId: '__other__', inputValue: '기타 사유' }],
    };

    const result = migrateResponseValue(legacyResponse, { '__other__': 'new-other-id' });

    expect(result.optionTexts).toEqual({ 'new-other-id': '기타 사유' });
    expect(result.otherInputs).toBeUndefined();
    expect(result.value).toEqual(['o4', 'new-other-id']);
  });

  it('converts ranking __other__ entries to real optionId + optionText', () => {
    const legacyResponse: LegacyResponseShape = {
      questionId: 'q5',
      value: [
        { rank: 1, optionValue: 'o2' },
        { rank: 2, optionValue: '__other__', otherText: '내가 적은 거' },
      ],
    };

    const result = migrateResponseValue(legacyResponse, { '__other__': 'new-other-id' });

    expect(result.value).toEqual([
      { rank: 1, optionValue: 'o2' },
      { rank: 2, optionValue: 'new-other-id', optionText: '내가 적은 거' },
    ]);
  });

  it('preserves non-other responses untouched', () => {
    const legacyResponse: LegacyResponseShape = {
      questionId: 'q1',
      value: ['o1', 'o2'],
    };

    const result = migrateResponseValue(legacyResponse, {});

    expect(result.value).toEqual(['o1', 'o2']);
    expect(result.optionTexts).toBeUndefined();
  });

  it('preserves __other__ in value when mapping is empty (defensive)', () => {
    const legacyResponse: LegacyResponseShape = {
      questionId: 'q1',
      value: ['o1', '__other__'],
      otherInputs: [{ optionId: '__other__', inputValue: '소실 위험 데이터' }],
    };

    // mapping 이 비어있음 -- 마이그레이션 스크립트가 매핑을 찾지 못한 케이스
    const result = migrateResponseValue(legacyResponse, {});

    // value 의 __other__ 는 그대로 유지 (production 데이터 보존)
    expect(result.value).toEqual(['o1', '__other__']);
    // 텍스트도 보존 -- __other__ 키로 보관됨 (사람이 수동으로 확인 가능)
    expect(result.optionTexts).toEqual({ '__other__': '소실 위험 데이터' });
  });

  it('returns no optionTexts when otherInputs is empty array', () => {
    const legacyResponse: LegacyResponseShape = {
      questionId: 'q1',
      value: ['o1'],
      otherInputs: [],
    };

    const result = migrateResponseValue(legacyResponse, {});

    expect(result.optionTexts).toBeUndefined();
  });
});

describe('migrateSnapshotQuestions', () => {
  it('migrates allowOtherOption inside snapshot question list', () => {
    const snapshot = {
      questions: [
        {
          id: 'q1',
          allowOtherOption: true,
          options: [{ id: 'o1', label: 'A', value: '1', optionCode: '1', spssNumericCode: 1 }],
        },
        {
          id: 'q2',
          allowOtherOption: false,
          options: [{ id: 'o2', label: 'B', value: '1', optionCode: '1', spssNumericCode: 1 }],
        },
      ],
    };

    const result = migrateSnapshotQuestions(snapshot);

    expect(result.questions[0].options).toHaveLength(2);
    expect(result.questions[0].allowOtherOption).toBeUndefined();
    expect(result.questions[1].options).toHaveLength(1);
    expect(result.otherIdMappings['q1']).toBeDefined();
    expect(result.otherIdMappings['q2']).toBeUndefined();
    expect(result.cellOtherIdMappings).toEqual({});
  });

  it('migrates table cell allowOtherOption', () => {
    const snapshot = {
      questions: [
        {
          id: 'q1',
          type: 'table',
          tableRowsData: [
            {
              id: 'r1',
              cells: [
                {
                  id: 'c1',
                  type: 'radio',
                  allowOtherOption: true,
                  radioOptions: [{ id: 'ro1', label: 'A', value: '1' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = migrateSnapshotQuestions(snapshot);

    const cell = result.questions[0].tableRowsData![0].cells[0];
    expect(cell.radioOptions).toHaveLength(2);
    expect(cell.allowOtherOption).toBeUndefined();
    expect(result.cellOtherIdMappings['q1']['c1']['__other__']).toBeDefined();
  });

  it('records cell-level mapping when table cell has allowOtherOption', () => {
    const snapshot = {
      questions: [
        {
          id: 'q1',
          type: 'table',
          tableRowsData: [
            {
              id: 'r1',
              cells: [
                {
                  id: 'c1',
                  type: 'radio',
                  allowOtherOption: true,
                  radioOptions: [{ id: 'ro1', label: 'A', value: '1' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = migrateSnapshotQuestions(snapshot);

    expect(result.cellOtherIdMappings['q1']).toBeDefined();
    expect(result.cellOtherIdMappings['q1']['c1']).toBeDefined();
    expect(result.cellOtherIdMappings['q1']['c1']['__other__']).toBeDefined();
    // 새로 생성된 기타 옵션 ID 와 mapping 의 ID 가 일치
    const newOtherId = result.cellOtherIdMappings['q1']['c1']['__other__'];
    const cell = result.questions[0].tableRowsData![0].cells[0];
    const addedOption = cell.radioOptions!.find(o => o.id === newOtherId);
    expect(addedOption).toBeDefined();
    expect(addedOption!.label).toBe('기타');
    expect(addedOption!.allowTextInput).toBe(true);
  });

  it('migrates checkbox and select cell types correctly', () => {
    const snapshot = {
      questions: [
        {
          id: 'q1',
          type: 'table',
          tableRowsData: [
            {
              id: 'r1',
              cells: [
                {
                  id: 'cb1',
                  type: 'checkbox',
                  allowOtherOption: true,
                  checkboxOptions: [{ id: 'cbo1', label: 'X', value: '1' }],
                },
                {
                  id: 'sel1',
                  type: 'select',
                  allowOtherOption: true,
                  selectOptions: [{ id: 'so1', label: 'Y', value: '1' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = migrateSnapshotQuestions(snapshot);

    const cells = result.questions[0].tableRowsData![0].cells;
    expect(cells[0].checkboxOptions).toHaveLength(2);
    expect(cells[1].selectOptions).toHaveLength(2);
    expect(result.cellOtherIdMappings['q1']['cb1']).toBeDefined();
    expect(result.cellOtherIdMappings['q1']['sel1']).toBeDefined();
  });

  it('skips non-option cell types with allowOtherOption=true (defensive)', () => {
    const snapshot = {
      questions: [
        {
          id: 'q1',
          type: 'table',
          tableRowsData: [
            {
              id: 'r1',
              cells: [
                {
                  id: 'txt1',
                  type: 'text',
                  allowOtherOption: true,  // legacy garbage data
                } as any,  // text 셀에 allowOtherOption 은 비정상이지만 방어
              ],
            },
          ],
        },
      ],
    };

    const result = migrateSnapshotQuestions(snapshot);

    // text 셀은 옵션이 없으므로 추가도 안 되고 mapping 도 없음
    const cell = result.questions[0].tableRowsData![0].cells[0];
    expect(cell.allowOtherOption).toBe(true);  // 그대로 유지 (skip)
    expect(result.cellOtherIdMappings['q1']?.['txt1']).toBeUndefined();
  });
});

describe('generateOtherOptionFields', () => {
  it('generates next sequential codes when 5 options exist', () => {
    const result = generateOtherOptionFields(5);
    expect(result).toEqual({
      optionCode: '6',
      spssNumericCode: 6,
      variableNumber: '6',
    });
  });

  it('zero-pads when 10+ options exist', () => {
    const result = generateOtherOptionFields(10);
    expect(result).toEqual({
      optionCode: '11',
      spssNumericCode: 11,
      variableNumber: '11',
    });
  });

  it('handles single-digit boundary correctly', () => {
    const result = generateOtherOptionFields(9);
    expect(result).toEqual({
      optionCode: '10',
      spssNumericCode: 10,
      variableNumber: '10',
    });
  });
});
