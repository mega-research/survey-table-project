import { describe, it, expect } from 'vitest';

import {
  parseClausesFromUrl,
  placeholderFor,
  type ColumnCandidate,
} from '@/lib/operations/contacts-filters.server';
import type { ContactResultCode } from '@/db/schema/schema-types';

describe('placeholderFor', () => {
  it('returns id range hint for system.resid', () => {
    expect(placeholderFor('system.resid')).toBe('예: 1-30, 45');
  });

  it('returns exact-match hint for pii.*', () => {
    expect(placeholderFor('pii.email')).toBe('정확한 값 입력 (부분 검색 불가)');
    expect(placeholderFor('pii.mobile')).toBe('정확한 값 입력 (부분 검색 불가)');
  });

  it('returns generic 검색어 for the rest', () => {
    expect(placeholderFor('attrs.전시회명')).toBe('검색어');
    expect(placeholderFor('system.contact_result')).toBe('검색어');
    expect(placeholderFor('system.web')).toBe('검색어');
  });
});

const candidates: ColumnCandidate[] = [
  { source: 'system.resid', label: '번호' },
  { source: 'system.contact_result', label: '결과코드' },
  { source: 'system.web', label: '응답' },
  { source: 'attrs.전시회명', label: '전시회명' },
  { source: 'attrs.지역', label: '지역' },
  { source: 'pii.email', label: '이메일', piiType: 'email' },
];

const resultCodes: ContactResultCode[] = [
  { code: '1.조사완료', label: '1.조사완료', order: 1 },
  { code: '2.재통화예약', label: '2.재통화예약', order: 2 },
];

describe('parseClausesFromUrl', () => {
  it('returns empty array for missing arrays', () => {
    expect(parseClausesFromUrl(undefined, undefined, undefined, candidates, resultCodes)).toEqual([]);
    expect(parseClausesFromUrl([], [], [], candidates, resultCodes)).toEqual([]);
  });
});

describe('parseClausesFromUrl - source 분기', () => {
  it('system.resid + 숫자 패턴 → idlist', () => {
    const result = parseClausesFromUrl(
      ['system.resid'],
      ['1-30, 45'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: {
          source: 'system.resid',
          mode: 'idlist',
          value: '1-30, 45',
          ranges: [
            { from: 1, to: 30 },
            { from: 45, to: 45 },
          ],
        },
      },
    ]);
  });

  it('system.resid + 비숫자 → text 폴백', () => {
    const result = parseClausesFromUrl(['system.resid'], ['abc'], [''], candidates, resultCodes);
    expect(result).toEqual([
      { op: null, condition: { source: 'system.resid', mode: 'text', value: 'abc' } },
    ]);
  });

  it('system.contact_result + enum 값 → enum', () => {
    const result = parseClausesFromUrl(
      ['system.contact_result'],
      ['1.조사완료'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: { source: 'system.contact_result', mode: 'enum', value: '1.조사완료' },
      },
    ]);
  });

  it('system.contact_result + enum 외 값 → drop', () => {
    expect(
      parseClausesFromUrl(['system.contact_result'], ['unknown'], [''], candidates, resultCodes),
    ).toEqual([]);
  });

  it('system.web + true/false → boolean', () => {
    const t = parseClausesFromUrl(['system.web'], ['true'], [''], candidates, resultCodes);
    expect(t[0].condition).toEqual({ source: 'system.web', mode: 'boolean', value: 'true' });
    const f = parseClausesFromUrl(['system.web'], ['false'], [''], candidates, resultCodes);
    expect(f[0].condition).toEqual({ source: 'system.web', mode: 'boolean', value: 'false' });
  });

  it('system.web + 외 값 → drop', () => {
    expect(parseClausesFromUrl(['system.web'], ['yes'], [''], candidates, resultCodes)).toEqual([]);
  });

  it('attrs.* → text', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명'],
      ['핵심'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      { op: null, condition: { source: 'attrs.전시회명', mode: 'text', value: '핵심' } },
    ]);
  });

  it('pii.email + 유효 이메일 → exact + blindIndex', () => {
    const result = parseClausesFromUrl(
      ['pii.email'],
      ['user@example.com'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toHaveLength(1);
    expect(result[0].condition.source).toBe('pii.email');
    expect(result[0].condition.mode).toBe('exact');
    expect(result[0].condition.value).toBe('user@example.com');
    expect(
      result[0].condition.mode === 'exact' &&
        /^[0-9a-f]{64}$/.test(result[0].condition.blindIndex ?? ''),
    ).toBe(true);
  });

  it('pii.* + 정규화 실패 → drop', () => {
    expect(parseClausesFromUrl(['pii.email'], ['abc'], [''], candidates, resultCodes)).toEqual([]);
  });

  it('pii.* + candidate 에 piiType 누락 → drop', () => {
    const candidatesNoPiiType: ColumnCandidate[] = [
      { source: 'pii.email', label: '이메일' },
    ];
    expect(
      parseClausesFromUrl(
        ['pii.email'],
        ['user@example.com'],
        [''],
        candidatesNoPiiType,
        resultCodes,
      ),
    ).toEqual([]);
  });

  it('whitelist 위반 → drop', () => {
    expect(parseClausesFromUrl(['attrs.unknown'], ['x'], [''], candidates, resultCodes)).toEqual(
      [],
    );
  });

  it('빈 q → drop', () => {
    expect(parseClausesFromUrl(['attrs.전시회명'], [''], [''], candidates, resultCodes)).toEqual(
      [],
    );
    expect(parseClausesFromUrl(['attrs.전시회명'], ['   '], [''], candidates, resultCodes)).toEqual(
      [],
    );
  });
});

describe('parseClausesFromUrl - 다중 조건', () => {
  it('첫 절 op 는 강제 null, 나머지는 AND/OR', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명', 'attrs.지역', 'attrs.지역'],
      ['핵심', '서울', '부산'],
      ['', 'AND', 'OR'],
      candidates,
      resultCodes,
    );
    expect(result.map((c) => c.op)).toEqual([null, 'AND', 'OR']);
  });

  it('op[0] 에 AND/OR 가 와도 첫 절은 null 로 강제', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명'],
      ['핵심'],
      ['OR'],
      candidates,
      resultCodes,
    );
    expect(result[0].op).toBeNull();
  });

  it('op 가 AND/OR 외 값이면 AND 폴백', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명', 'attrs.지역'],
      ['핵심', '서울'],
      ['', 'XOR'],
      candidates,
      resultCodes,
    );
    expect(result[1].op).toBe('AND');
  });

  it('길이 불일치 → 짧은 쪽까지만 (silent truncate)', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명', 'attrs.지역'],
      ['핵심'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toHaveLength(1);
  });

  it('일부 drop, 나머지 유지 (인덱스 보존 아님 — 통과한 절 순서대로)', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명', 'attrs.unknown', 'attrs.지역'],
      ['핵심', 'x', '서울'],
      ['', 'AND', 'OR'],
      candidates,
      resultCodes,
    );
    expect(result).toHaveLength(2);
    expect(result[0].condition.source).toBe('attrs.전시회명');
    expect(result[1].condition.source).toBe('attrs.지역');
    expect(result[1].op).toBe('OR');
  });
});
