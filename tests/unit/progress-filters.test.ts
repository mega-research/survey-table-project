import { describe, it, expect, beforeAll } from 'vitest';

import {
  parseIdListInput,
  placeholderFor,
  parseConditionFromUrl,
  type ColumnCandidate,
} from '@/lib/operations/progress-filters';

beforeAll(() => {
  process.env.CONTACT_PII_HMAC_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('parseIdListInput', () => {
  it('parses a single integer', () => {
    expect(parseIdListInput('5')).toEqual([{ from: 5, to: 5 }]);
  });

  it('parses a simple range', () => {
    expect(parseIdListInput('1-30')).toEqual([{ from: 1, to: 30 }]);
  });

  it('parses mixed list of singles and ranges', () => {
    expect(parseIdListInput('1-30, 45')).toEqual([
      { from: 1, to: 30 },
      { from: 45, to: 45 },
    ]);
  });

  it('tolerates whitespace around separators', () => {
    expect(parseIdListInput('  1 - 30 ,  45  ')).toEqual([
      { from: 1, to: 30 },
      { from: 45, to: 45 },
    ]);
  });

  it('swaps reversed ranges', () => {
    expect(parseIdListInput('50-10')).toEqual([{ from: 10, to: 50 }]);
  });

  it('rejects empty input', () => {
    expect(parseIdListInput('')).toBeNull();
    expect(parseIdListInput('   ')).toBeNull();
  });

  it('rejects double commas', () => {
    expect(parseIdListInput('1,,2')).toBeNull();
    expect(parseIdListInput('1,')).toBeNull();
    expect(parseIdListInput(',1')).toBeNull();
  });

  it('rejects decimals', () => {
    expect(parseIdListInput('1.5')).toBeNull();
  });

  it('rejects values larger than int32 max', () => {
    expect(parseIdListInput('2147483648')).toBeNull();
  });

  it('rejects text', () => {
    expect(parseIdListInput('abc')).toBeNull();
    expect(parseIdListInput('1-abc')).toBeNull();
  });
});

describe('placeholderFor', () => {
  it('returns default for null source', () => {
    expect(placeholderFor(null)).toBe('검색어');
  });

  it('returns id range hint for system.resid', () => {
    expect(placeholderFor('system.resid')).toBe('예: 1-30, 45');
  });

  it('returns exact-match hint for pii.*', () => {
    expect(placeholderFor('pii.email')).toBe('정확한 값 입력 (부분 검색 불가)');
    expect(placeholderFor('pii.mobile')).toBe('정확한 값 입력 (부분 검색 불가)');
  });

  it('returns partial-match hint for attrs.*', () => {
    expect(placeholderFor('attrs.전시회명')).toBe('부분일치');
  });
});

describe('parseConditionFromUrl', () => {
  const candidates: ColumnCandidate[] = [
    { source: 'system.resid', label: '컨택번호' },
    { source: 'attrs.전시회명', label: '전시회명' },
    { source: 'attrs.개최월', label: '개최월' },
    { source: 'pii.email', label: '이메일', piiType: 'email' },
  ];

  it('returns null for null col', () => {
    expect(parseConditionFromUrl(null, 'x', candidates)).toBeNull();
  });

  it('returns null for empty q', () => {
    expect(parseConditionFromUrl('attrs.전시회명', '', candidates)).toBeNull();
    expect(parseConditionFromUrl('attrs.전시회명', '   ', candidates)).toBeNull();
    expect(parseConditionFromUrl('attrs.전시회명', null, candidates)).toBeNull();
  });

  it('returns null for whitelist violation', () => {
    expect(parseConditionFromUrl('attrs.unknown', 'x', candidates)).toBeNull();
    expect(parseConditionFromUrl('system.contact_result', 'x', candidates)).toBeNull();
  });

  it('parses system.resid with numeric pattern as idlist', () => {
    expect(parseConditionFromUrl('system.resid', '1-30, 45', candidates)).toEqual({
      source: 'system.resid',
      mode: 'idlist',
      ranges: [
        { from: 1, to: 30 },
        { from: 45, to: 45 },
      ],
    });
  });

  it('parses system.resid with non-numeric as text fallback', () => {
    expect(parseConditionFromUrl('system.resid', 'abc', candidates)).toEqual({
      source: 'system.resid',
      mode: 'text',
      value: 'abc',
    });
  });

  it('parses attrs.* as text', () => {
    expect(parseConditionFromUrl('attrs.전시회명', '핵심', candidates)).toEqual({
      source: 'attrs.전시회명',
      mode: 'text',
      value: '핵심',
    });
  });

  it('trims attrs value', () => {
    const result = parseConditionFromUrl('attrs.전시회명', '  핵심  ', candidates);
    expect(result).toEqual({
      source: 'attrs.전시회명',
      mode: 'text',
      value: '핵심',
    });
  });

  it('parses pii.* with computed blindIndex', () => {
    const result = parseConditionFromUrl('pii.email', 'user@example.com', candidates);
    expect(result).toMatchObject({
      source: 'pii.email',
      mode: 'exact',
      value: 'user@example.com',
    });
    expect(result?.mode === 'exact' && /^[0-9a-f]{64}$/.test(result.blindIndex)).toBe(true);
  });

  it('returns null for pii.* when candidate missing piiType', () => {
    const candidatesNoPiiType: ColumnCandidate[] = [
      { source: 'pii.email', label: '이메일' },
    ];
    expect(parseConditionFromUrl('pii.email', 'user@example.com', candidatesNoPiiType)).toBeNull();
  });
});
