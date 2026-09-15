import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { applyInputTypeChange } from './input-mode';

const numbered = {
  inputType: 'number',
  emptyDefault: 0,
  numberFormat: { thousandSeparator: true },
} as Partial<Question> as Question;

describe('applyInputTypeChange', () => {
  it('형식으로 넘어가면 숫자 전용 설정을 버린다 (배타)', () => {
    const next = applyInputTypeChange(numbered, 'mobile');
    expect(next.inputType).toBe('mobile');
    expect('emptyDefault' in next).toBe(false);
    expect('numberFormat' in next).toBe(false);
  });

  it('지정을 끄면 숫자 전용 설정을 버린다', () => {
    const next = applyInputTypeChange(numbered, 'text');
    expect(next.inputType).toBe('text');
    expect('emptyDefault' in next).toBe(false);
    expect('numberFormat' in next).toBe(false);
  });

  it('숫자 모드로 켜면 기존 숫자 설정을 보존한다', () => {
    const fromFormat = applyInputTypeChange(numbered, 'email');
    const back = applyInputTypeChange({ ...fromFormat, emptyDefault: 3 } as Question, 'number');
    expect(back.inputType).toBe('number');
    expect(back.emptyDefault).toBe(3);
  });

  it('원본을 건드리지 않는다', () => {
    applyInputTypeChange(numbered, 'phone');
    expect(numbered.emptyDefault).toBe(0);
  });
});
