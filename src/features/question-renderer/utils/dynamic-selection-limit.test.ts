import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { resolveMaxSelections, withResolvedMaxSelections } from './dynamic-selection-limit';

const SOURCE = { questionId: 'b2', unlimitedFrom: 5 };

describe('resolveMaxSelections', () => {
  it('출처가 없으면 고정값 그대로 — 0·미지정은 제한 없음', () => {
    expect(resolveMaxSelections({ maxSelections: 3 }, { b2: '1' })).toBe(3);
    expect(resolveMaxSelections({ maxSelections: 0 }, {})).toBeUndefined();
    expect(resolveMaxSelections({}, {})).toBeUndefined();
  });

  it('참조 문항의 숫자 응답이 상한이 된다', () => {
    expect(resolveMaxSelections({ maxSelectionsSource: SOURCE }, { b2: '1' })).toBe(1);
    expect(resolveMaxSelections({ maxSelectionsSource: SOURCE }, { b2: '4' })).toBe(4);
  });

  it('참조값이 unlimitedFrom 이상이면 제한 없음 — 고정값도 무시한다', () => {
    expect(
      resolveMaxSelections({ maxSelections: 2, maxSelectionsSource: SOURCE }, { b2: '5' }),
    ).toBeUndefined();
    expect(resolveMaxSelections({ maxSelectionsSource: SOURCE }, { b2: '12' })).toBeUndefined();
  });

  it('unlimitedFrom 이 없으면 참조값이 항상 상한이다', () => {
    expect(resolveMaxSelections({ maxSelectionsSource: { questionId: 'b2' } }, { b2: '9' })).toBe(
      9,
    );
  });

  it('참조값을 못 읽으면 고정값으로 폴백한다 — 미응답·빈 문자열·숫자 아님·1 미만', () => {
    const q = { maxSelections: 3, maxSelectionsSource: SOURCE };
    expect(resolveMaxSelections(q, {})).toBe(3);
    expect(resolveMaxSelections(q, undefined)).toBe(3);
    expect(resolveMaxSelections(q, { b2: '  ' })).toBe(3);
    expect(resolveMaxSelections(q, { b2: 'abc' })).toBe(3);
    expect(resolveMaxSelections(q, { b2: '0' })).toBe(3);
    expect(resolveMaxSelections({ maxSelectionsSource: SOURCE }, { b2: '0' })).toBeUndefined();
  });

  it('참조 문항을 고르지 않은 출처는 없는 것으로 본다', () => {
    expect(
      resolveMaxSelections({ maxSelections: 2, maxSelectionsSource: { questionId: '' } }, {}),
    ).toBe(2);
  });

  it('소수는 내림한다', () => {
    expect(resolveMaxSelections({ maxSelectionsSource: SOURCE }, { b2: '2.7' })).toBe(2);
  });
});

describe('withResolvedMaxSelections', () => {
  const base = { id: 'b3', type: 'checkbox', title: 'B3', required: true, order: 1 } as Question;

  it('출처가 없는 문항은 같은 참조를 돌려준다', () => {
    const q = { ...base, maxSelections: 3 };
    expect(withResolvedMaxSelections(q, { b2: '1' })).toBe(q);
  });

  it('해석된 상한을 maxSelections 에 싣는다', () => {
    const q = { ...base, maxSelectionsSource: SOURCE };
    expect(withResolvedMaxSelections(q, { b2: '2' }).maxSelections).toBe(2);
  });

  it('제한 없음이면 고정값을 걷어 낸다', () => {
    const q = { ...base, maxSelections: 2, maxSelectionsSource: SOURCE };
    const resolved = withResolvedMaxSelections(q, { b2: '6' });
    expect(resolved.maxSelections).toBeUndefined();
    expect('maxSelections' in resolved).toBe(false);
  });
});
