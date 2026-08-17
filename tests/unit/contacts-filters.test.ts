import { describe, it, expect } from 'vitest';

import {
  parseClausesFromUrl,
  parseHeaderFiltersFromUrl,
  placeholderFor,
  type ColumnCandidate,
} from '@/lib/operations/contacts-filters.server';
import { HEADER_FILTER_VALUE_SEPARATOR as SEP } from '@/lib/operations/filter-shared';
import type { ContactResultCode } from '@/db/schema/schema-types';

describe('placeholderFor', () => {
  it('returns id range hint for system.resid', () => {
    expect(placeholderFor('system.resid')).toBe('예: 1-30, 45');
  });

  it('returns exact-match hint for pii.*', () => {
    expect(placeholderFor('pii.email')).toBe('정확한 값 입력 (부분 검색 불가)');
    expect(placeholderFor('pii.mobile')).toBe('정확한 값 입력 (부분 검색 불가)');
  });

  it('attrs 는 범위 검색 힌트 포함, 나머지는 검색어 계열', () => {
    expect(placeholderFor('attrs.전시회명')).toBe('검색어 또는 범위 (예: 10-13)');
    expect(placeholderFor('system.contact_result')).toBe('검색어 또는 범위 (예: 10-13)');
    expect(placeholderFor('system.web')).toBe('검색어 또는 범위 (예: 10-13)');
  });

  it('system.all 은 전체 검색 안내', () => {
    expect(placeholderFor('system.all')).toBe('전체 검색 (암호화 컬럼은 전문 일치)');
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
    const t0 = t[0];
    if (!t0) throw new Error('expected t[0]');
    expect(t0.condition).toEqual({ source: 'system.web', mode: 'boolean', value: 'true' });
    const f = parseClausesFromUrl(['system.web'], ['false'], [''], candidates, resultCodes);
    const f0 = f[0];
    if (!f0) throw new Error('expected f[0]');
    expect(f0.condition).toEqual({ source: 'system.web', mode: 'boolean', value: 'false' });
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

  it('attrs.* + 범위 문법 → idlist (NO 범위 검색)', () => {
    const result = parseClausesFromUrl(
      ['attrs.지역'],
      ['10-13, 15'],
      [''],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: {
          source: 'attrs.지역',
          mode: 'idlist',
          value: '10-13, 15',
          ranges: [
            { from: 10, to: 13 },
            { from: 15, to: 15 },
          ],
        },
      },
    ]);
  });

  it('attrs.* + 단일 숫자는 부분검색 유지 (범위 문법 - , 있어야 idlist)', () => {
    const single = parseClausesFromUrl(['attrs.지역'], ['15'], [''], candidates, resultCodes);
    const s0 = single[0];
    if (!s0) throw new Error('expected single[0]');
    expect(s0.condition.mode).toBe('text');
    // 숫자가 아닌 하이픈 문자열도 text 유지
    const textDash = parseClausesFromUrl(
      ['attrs.지역'],
      ['서울-강남'],
      [''],
      candidates,
      resultCodes,
    );
    const t0 = textDash[0];
    if (!t0) throw new Error('expected textDash[0]');
    expect(t0.condition.mode).toBe('text');
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
    const clause0 = result[0];
    if (!clause0) throw new Error('expected result[0]');
    expect(clause0.condition.source).toBe('pii.email');
    expect(clause0.condition.mode).toBe('exact');
    expect(clause0.condition.value).toBe('user@example.com');
    expect(
      clause0.condition.mode === 'exact' &&
        /^[0-9a-f]{64}$/.test(clause0.condition.blindIndex ?? ''),
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

  it('system.all + 일반 텍스트 → attrs 전체를 text OR 로 전개 (pii 는 정규화 실패로 제외)', () => {
    const result = parseClausesFromUrl(['system.all'], ['핵심'], [''], candidates, resultCodes);
    expect(result).toHaveLength(1);
    const c0 = result[0];
    if (!c0) throw new Error('expected result[0]');
    expect(c0.condition.mode).toBe('any');
    expect(c0.condition.subConditions).toEqual([
      { source: 'attrs.전시회명', mode: 'text', value: '핵심' },
      { source: 'attrs.지역', mode: 'text', value: '핵심' },
    ]);
  });

  it('system.all + 유효 이메일 → pii exact(blindIndex 포함)도 OR 에 포함', () => {
    const result = parseClausesFromUrl(
      ['system.all'],
      ['user@example.com'],
      [''],
      candidates,
      resultCodes,
    );
    const c0 = result[0];
    if (!c0) throw new Error('expected result[0]');
    const piiSub = (c0.condition.subConditions ?? []).find((s) => s.source === 'pii.email');
    if (!piiSub) throw new Error('expected pii.email subcondition');
    expect(piiSub.mode).toBe('exact');
    expect(/^[0-9a-f]{64}$/.test(piiSub.blindIndex ?? '')).toBe(true);
  });

  it('system.all — 범위 문법도 전체 모드에선 일반 텍스트로 취급', () => {
    const result = parseClausesFromUrl(['system.all'], ['10-13'], [''], candidates, resultCodes);
    const c0 = result[0];
    if (!c0) throw new Error('expected result[0]');
    const subs = c0.condition.subConditions ?? [];
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((s) => s.mode === 'text')).toBe(true);
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
    const first0 = result[0];
    if (!first0) throw new Error('expected result[0]');
    expect(first0.op).toBeNull();
  });

  it('op 가 AND/OR 외 값이면 AND 폴백', () => {
    const result = parseClausesFromUrl(
      ['attrs.전시회명', 'attrs.지역'],
      ['핵심', '서울'],
      ['', 'XOR'],
      candidates,
      resultCodes,
    );
    const second = result[1];
    if (!second) throw new Error('expected result[1]');
    expect(second.op).toBe('AND');
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
    const r0 = result[0];
    const r1 = result[1];
    if (!r0 || !r1) throw new Error('expected result[0] and result[1]');
    expect(r0.condition.source).toBe('attrs.전시회명');
    expect(r1.condition.source).toBe('attrs.지역');
    expect(r1.op).toBe('OR');
  });

  it('URL 첫 절이 drop 되어도 출력 첫 절의 op 는 null', () => {
    // col[0] 는 화이트리스트 위반으로 drop → 통과한 col[1] 이 결과의 첫 절이 됨.
    // URL 인덱스 기준이 아니라 출력 인덱스 기준으로 op=null 이 부여되어야 한다.
    const result = parseClausesFromUrl(
      ['attrs.unknown', 'attrs.지역'],
      ['x', '서울'],
      ['', 'OR'],
      candidates,
      resultCodes,
    );
    expect(result).toHaveLength(1);
    const dropped0 = result[0];
    if (!dropped0) throw new Error('expected result[0]');
    expect(dropped0.op).toBeNull();
    expect(dropped0.condition.source).toBe('attrs.지역');
  });
});

describe('parseHeaderFiltersFromUrl', () => {
  it('빈 입력 → 빈 배열', () => {
    expect(parseHeaderFiltersFromUrl(undefined, undefined, undefined, candidates, resultCodes)).toEqual([]);
  });

  it('attrs in — 구분자 조인 값 목록을 in 절로 파싱, 전부 AND 결합', () => {
    const result = parseHeaderFiltersFromUrl(
      ['attrs.지역', 'attrs.전시회명'],
      ['in', 'in'],
      [`서울${SEP}부산`, '핵심'],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: { source: 'attrs.지역', mode: 'in', value: '', values: ['서울', '부산'] },
      },
      {
        op: 'AND',
        condition: { source: 'attrs.전시회명', mode: 'in', value: '', values: ['핵심'] },
      },
    ]);
  });

  it('attrs text — 고카디널리티 폴백 부분검색', () => {
    const result = parseHeaderFiltersFromUrl(
      ['attrs.전시회명'],
      ['text'],
      ['핵심'],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      { op: null, condition: { source: 'attrs.전시회명', mode: 'text', value: '핵심' } },
    ]);
  });

  it('attrs text — 범위 문법 입력은 idlist 로 승격 (헤더 필터에서도 NO 범위 검색)', () => {
    const result = parseHeaderFiltersFromUrl(
      ['attrs.지역'],
      ['text'],
      ['10-13, 15'],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: {
          source: 'attrs.지역',
          mode: 'idlist',
          value: '10-13, 15',
          ranges: [
            { from: 10, to: 13 },
            { from: 15, to: 15 },
          ],
        },
      },
    ]);
  });

  it('pii exact — blindIndex 계산 포함', () => {
    const result = parseHeaderFiltersFromUrl(
      ['pii.email'],
      ['exact'],
      ['user@example.com'],
      candidates,
      resultCodes,
    );
    expect(result).toHaveLength(1);
    const c0 = result[0];
    if (!c0) throw new Error('expected result[0]');
    expect(c0.condition.mode).toBe('exact');
    expect(/^[0-9a-f]{64}$/.test(c0.condition.blindIndex ?? '')).toBe(true);
  });

  it('system.contact_result in — 유효 코드만 통과, 전부 무효면 drop', () => {
    const result = parseHeaderFiltersFromUrl(
      ['system.contact_result'],
      ['in'],
      [`1.조사완료${SEP}없는코드`],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      {
        op: null,
        condition: {
          source: 'system.contact_result',
          mode: 'in',
          value: '',
          values: ['1.조사완료'],
        },
      },
    ]);
    expect(
      parseHeaderFiltersFromUrl(['system.contact_result'], ['in'], ['없는코드'], candidates, resultCodes),
    ).toEqual([]);
  });

  it('system.web in — true/false 외 값 필터링', () => {
    const result = parseHeaderFiltersFromUrl(
      ['system.web'],
      ['in'],
      [`true${SEP}maybe`],
      candidates,
      resultCodes,
    );
    expect(result).toEqual([
      { op: null, condition: { source: 'system.web', mode: 'in', value: '', values: ['true'] } },
    ]);
  });

  it('source-mode 불일치 조합은 drop — attrs+exact, pii+in, pii+text', () => {
    expect(
      parseHeaderFiltersFromUrl(['attrs.지역'], ['exact'], ['서울'], candidates, resultCodes),
    ).toEqual([]);
    expect(
      parseHeaderFiltersFromUrl(['pii.email'], ['in'], ['user@example.com'], candidates, resultCodes),
    ).toEqual([]);
    expect(
      parseHeaderFiltersFromUrl(['pii.email'], ['text'], ['user'], candidates, resultCodes),
    ).toEqual([]);
  });

  it('화이트리스트 위반·빈 값·중복 컬럼 처리', () => {
    // 화이트리스트 위반 drop
    expect(
      parseHeaderFiltersFromUrl(['attrs.unknown'], ['in'], ['x'], candidates, resultCodes),
    ).toEqual([]);
    // 빈 값 토큰만 있으면 drop
    expect(
      parseHeaderFiltersFromUrl(['attrs.지역'], ['in'], [`${SEP}`], candidates, resultCodes),
    ).toEqual([]);
    // 같은 컬럼 중복 등장 시 뒤 항목이 이김 (드롭다운 재적용 시나리오)
    const dup = parseHeaderFiltersFromUrl(
      ['attrs.지역', 'attrs.지역'],
      ['in', 'in'],
      ['서울', '부산'],
      candidates,
      resultCodes,
    );
    expect(dup).toHaveLength(1);
    const d0 = dup[0];
    if (!d0) throw new Error('expected dup[0]');
    expect(d0.condition.values).toEqual(['부산']);
  });
});
