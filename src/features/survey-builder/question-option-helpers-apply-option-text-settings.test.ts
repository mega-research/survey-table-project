import { describe, expect, it } from 'vitest';

import type { RadioOption } from '@/types/survey';

import { applyOptionTextSettings } from './question-option-helpers';

/**
 * 옵션 텍스트(allowTextInput) 설정 반영 규칙.
 *
 * 저장 형태를 choice_opt 셀(serialize-cell)과 맞춘다 — 숫자 모드가 꺼지면 키를 남기지
 * 않는다. 죽은 `textInputType: 'text'` 가 JSONB 에 남으면 "숫자 모드였던 흔적"과
 * "명시적으로 텍스트"가 구분되지 않고, 발행 스냅샷 diff 에도 잡음이 낀다.
 */
describe('applyOptionTextSettings', () => {
  const base: RadioOption = { id: 'a', label: '매출액', value: '1', allowTextInput: true };

  it('숫자 모드를 켜면 textInputType 이 붙는다', () => {
    const next = applyOptionTextSettings(base, { textInputType: 'number' });
    expect(next.textInputType).toBe('number');
  });

  it('숫자 형식을 함께 주면 textInputNumberFormat 이 붙는다', () => {
    const next = applyOptionTextSettings(base, {
      textInputType: 'number',
      textInputNumberFormat: { unit: 'million', unitSuffix: '원', thousandSeparator: true },
    });
    expect(next.textInputNumberFormat).toEqual({
      unit: 'million',
      unitSuffix: '원',
      thousandSeparator: true,
    });
  });

  it('숫자 모드를 끄면 textInputType·textInputNumberFormat 키가 사라진다', () => {
    const numbered = applyOptionTextSettings(base, {
      textInputType: 'number',
      textInputNumberFormat: { unit: 'million' },
    });
    const next = applyOptionTextSettings(numbered, { textInputType: 'text' });
    expect('textInputType' in next).toBe(false);
    expect('textInputNumberFormat' in next).toBe(false);
  });

  it('숫자 모드여도 형식이 비면 textInputNumberFormat 키를 남기지 않는다', () => {
    const numbered = applyOptionTextSettings(base, {
      textInputType: 'number',
      textInputNumberFormat: { unit: 'million' },
    });
    const next = applyOptionTextSettings(numbered, { textInputType: 'number' });
    expect(next.textInputType).toBe('number');
    expect('textInputNumberFormat' in next).toBe(false);
  });

  it('placeholder 는 빈 문자열도 그대로 반영한다 (기존 동작 유지)', () => {
    const withText = applyOptionTextSettings(base, { textInputPlaceholder: '백만원 단위' });
    expect(withText.textInputPlaceholder).toBe('백만원 단위');
    const cleared = applyOptionTextSettings(withText, { textInputPlaceholder: '' });
    expect(cleared.textInputPlaceholder).toBe('');
  });

  it('옵션의 다른 필드는 건드리지 않는다', () => {
    const next = applyOptionTextSettings(base, { textInputType: 'number' });
    expect(next.id).toBe('a');
    expect(next.label).toBe('매출액');
    expect(next.value).toBe('1');
    expect(next.allowTextInput).toBe(true);
  });

  it('입력 형식도 그대로 실린다 — 숫자 모드만 통과시키면 형식이 조용히 버려진다', () => {
    const next = applyOptionTextSettings(base, { textInputType: 'mobile' });
    expect(next.textInputType).toBe('mobile');
  });

  it('형식을 고르면 숫자 서식은 남지 않는다 (배타)', () => {
    const numbered = applyOptionTextSettings(base, {
      textInputType: 'number',
      textInputNumberFormat: { unit: 'million' },
    });
    const formatted = applyOptionTextSettings(numbered, { textInputType: 'email' });
    expect(formatted.textInputType).toBe('email');
    expect('textInputNumberFormat' in formatted).toBe(false);
  });
});
