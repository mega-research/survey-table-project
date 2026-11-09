import { describe, expect, it } from 'vitest';

import {
  formatAllowedValuesText,
  parseAllowedValuesText,
} from '@/features/survey-builder/utils/allowed-values-text';

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('parseAllowedValuesText', () => {
  it('쉼표로 나눈 낱값을 읽는다', () => {
    expect(parseAllowedValuesText('2, 8')).toEqual([2, 8]);
  });

  it('「시작-끝」 범위를 정수로 펼치고 낱값과 섞어 쓸 수 있다', () => {
    expect(parseAllowedValuesText('1900-2026, 9999')).toEqual([...range(1900, 2026), 9999]);
  });

  it('물결표·띄어쓰기·거꾸로 쓴 범위도 받는다', () => {
    expect(parseAllowedValuesText('1 ~ 3')).toEqual([1, 2, 3]);
    expect(parseAllowedValuesText('5-3')).toEqual([3, 4, 5]);
  });

  it('음수 낱값과 음수 범위를 받는다', () => {
    expect(parseAllowedValuesText('-1, -3--2')).toEqual([-1, -3, -2]);
  });

  it('겹치는 값은 한 번만 남긴다', () => {
    expect(parseAllowedValuesText('1-3, 2, 3-4')).toEqual([1, 2, 3, 4]);
  });

  it('쓰는 중인 조각과 너무 넓은 범위는 버린다', () => {
    expect(parseAllowedValuesText('1900-')).toEqual([]);
    expect(parseAllowedValuesText('1-100000, 7')).toEqual([7]);
  });
});

describe('formatAllowedValuesText', () => {
  it('세 개 이상 이어진 정수는 범위로 묶는다', () => {
    expect(formatAllowedValuesText([...range(1900, 2026), 9999])).toBe('1900-2026, 9999');
    expect(formatAllowedValuesText([...range(1, 12), 99])).toBe('1-12, 99');
  });

  it('두 개만 이어지면 낱값으로 둔다', () => {
    expect(formatAllowedValuesText([8, 2, 3])).toBe('2, 3, 8');
  });

  it('음수가 낀 범위는 물결표로 쓴다', () => {
    expect(formatAllowedValuesText([-3, -2, -1, 0])).toBe('-3~0');
  });

  it('소수는 낱값으로 둔다', () => {
    expect(formatAllowedValuesText([0.5, 1, 1.5])).toBe('0.5, 1, 1.5');
  });

  it('읽은 글과 다시 쓴 글이 같은 값을 가리킨다', () => {
    const text = '1900-2026, 9999';
    expect(formatAllowedValuesText(parseAllowedValuesText(text))).toBe(text);
  });

  it('비어 있으면 빈 글', () => {
    expect(formatAllowedValuesText(undefined)).toBe('');
    expect(formatAllowedValuesText([])).toBe('');
  });
});
