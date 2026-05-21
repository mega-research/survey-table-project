import { describe, expect, it } from 'vitest';
import {
  migrateQuestionOptions,
  migrateResponseValue,
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
    expect(result.options[5]).toMatchObject({
      label: '기타',
      allowTextInput: true,
      optionCode: '6',
      spssNumericCode: 6,
    });
    expect(result.options[5].id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(result.migratedOtherOptionId).toBe(result.options[5].id);
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
    expect(result.options[10].optionCode).toBe('11');
    expect(result.options[10].spssNumericCode).toBe(11);
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

    expect(second.options).toHaveLength(first.options.length);
    expect(second.migratedOtherOptionId).toBeNull();
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
