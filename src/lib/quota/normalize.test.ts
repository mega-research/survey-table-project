import { describe, expect, it } from 'vitest';

import { normalizeQuotaConfig, parseQuotaTotalTarget, quotaTotalTarget } from './normalize';

describe('quotaTotalTarget — 「완료」 조건의 목표', () => {
  it('1 이상 정수만 목표로 읽는다', () => {
    expect(quotaTotalTarget({ totalTarget: 1100 })).toBe(1100);
    expect(quotaTotalTarget({ totalTarget: 1 })).toBe(1);
  });

  it('없거나 해석할 수 없는 값은 조건 없음(null)이다 — JSONB 드리프트 포함', () => {
    expect(quotaTotalTarget(null)).toBeNull();
    expect(quotaTotalTarget({})).toBeNull();
    expect(quotaTotalTarget({ totalTarget: null })).toBeNull();
    expect(quotaTotalTarget({ totalTarget: 0 })).toBeNull();
    expect(quotaTotalTarget({ totalTarget: -5 })).toBeNull();
    expect(quotaTotalTarget({ totalTarget: 10.5 })).toBeNull();
    expect(quotaTotalTarget({ totalTarget: '1100' as unknown as number })).toBeNull();
  });
});

describe('normalizeQuotaConfig — 「완료」 조건', () => {
  const base = { enabled: true, dimensions: [], cells: [], closedMessage: null };

  it('유효한 목표는 그대로 싣는다', () => {
    expect(normalizeQuotaConfig({ ...base, totalTarget: 1100 })).toMatchObject({ totalTarget: 1100 });
  });

  it('깨진 목표는 조건 없음으로 낮춘다 — 플랜의 나머지는 보존한다', () => {
    const normalized = normalizeQuotaConfig({ ...base, totalTarget: 'abc', closedMessage: '마감' });
    expect(normalized).toMatchObject({ totalTarget: null, closedMessage: '마감', enabled: true });
  });

  it('조건을 쓴 적 없는 플랜에는 키를 만들지 않는다', () => {
    expect(normalizeQuotaConfig(base)).not.toHaveProperty('totalTarget');
  });
});

describe('parseQuotaTotalTarget — 편집 화면 입력', () => {
  it('정수 글자를 목표로 읽는다 — 천 단위 쉼표와 앞뒤 공백은 정돈한다', () => {
    expect(parseQuotaTotalTarget('1100')).toBe(1100);
    expect(parseQuotaTotalTarget(' 1,100 ')).toBe(1100);
    expect(parseQuotaTotalTarget('1')).toBe(1);
  });

  it('빈 칸·0·음수·소수·글자는 저장할 수 없는 값(null)이다', () => {
    // 해석 못 한 입력을 0 이나 「조건 없음」으로 조용히 바꾸지 않는다 — 저장이 막힌다.
    for (const bad of ['', '0', '-3', '10.5', '천백', '1e3']) {
      expect(parseQuotaTotalTarget(bad)).toBeNull();
    }
  });

  it('서버가 받는 상한을 넘으면 null 이다', () => {
    expect(parseQuotaTotalTarget('10000000')).toBe(10_000_000);
    expect(parseQuotaTotalTarget('10000001')).toBeNull();
  });
});
