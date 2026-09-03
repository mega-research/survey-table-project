import { describe, expect, it } from 'vitest';

import type { ProfileColumnScheme } from '@/db/schema/schema-types';
import { normalizeContactColumnScheme } from '@/lib/operations/contacts';
import {
  formatIpHash,
  hydrateProfileColumns,
  selectRawExportContactColumns,
  visibleProfileColumns,
} from '@/lib/operations/profile-columns';

const contactScheme = normalizeContactColumnScheme({
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '번호', source: 'system.resid', order: 0 },
    { key: '업체명', label: '업체명', source: 'attrs.업체명', order: 1 },
    { key: '지역', label: '지역', source: 'attrs.지역', order: 2 },
    { key: '담당자', label: '담당자', source: 'pii.담당자', order: 3 },
  ],
})!;

describe('hydrateProfileColumns', () => {
  it('저장 스킴이 없으면 시스템 컬럼 기본 세트 + attrs/pii 풀(숨김)을 만든다', () => {
    const cols = hydrateProfileColumns(contactScheme, null);

    const keys = cols.map((c) => c.key);
    expect(keys).toEqual([
      'sys.idx',
      'sys.resid',
      'sys.group',
      'sys.platform',
      'sys.browser',
      'sys.status',
      'sys.startedAt',
      'sys.completedAt',
      'sys.totalSeconds',
      'sys.ipHash',
      'attrs.업체명',
      'attrs.지역',
      'pii.담당자',
    ]);

    // 기본 표시: 기존 9컬럼은 보임, ipHash 와 attrs/pii 는 숨김
    const hiddenKeys = cols.filter((c) => c.hidden).map((c) => c.key);
    expect(hiddenKeys).toEqual(['sys.ipHash', 'attrs.업체명', 'attrs.지역', 'pii.담당자']);
  });

  it('sys.resid 기본 라벨은 컨택 스킴의 system.resid 라벨을 따른다', () => {
    const cols = hydrateProfileColumns(contactScheme, null);
    expect(cols.find((c) => c.key === 'sys.resid')?.label).toBe('번호');
  });

  it('컨택 스킴이 없으면 sys.resid 라벨은 기본값이고 attrs/pii 는 없다', () => {
    const cols = hydrateProfileColumns(null, null);
    expect(cols.find((c) => c.key === 'sys.resid')?.label).toBe('시스템ID');
    expect(cols.some((c) => c.key.startsWith('attrs.') || c.key.startsWith('pii.'))).toBe(false);
  });

  it('저장 스킴 항목이 라벨·순서·숨김을 이긴다', () => {
    const saved: ProfileColumnScheme = {
      version: 1,
      columns: [
        { key: 'attrs.업체명', label: '회사', order: 0, hidden: false },
        { key: 'sys.idx', label: 'NO', order: 1 },
      ],
    };
    const cols = hydrateProfileColumns(contactScheme, saved);

    expect(cols[0]).toMatchObject({ key: 'attrs.업체명', label: '회사', hidden: false });
    expect(cols[1]).toMatchObject({ key: 'sys.idx', label: 'NO' });
  });

  it('컨택 스킴에서 사라진 attrs 키(고아)는 결과에서 제거된다', () => {
    const saved: ProfileColumnScheme = {
      version: 1,
      columns: [{ key: 'attrs.삭제된키', label: '옛컬럼', order: 0 }],
    };
    const cols = hydrateProfileColumns(contactScheme, saved);
    expect(cols.some((c) => c.key === 'attrs.삭제된키')).toBe(false);
  });
});

describe('visibleProfileColumns', () => {
  it('hidden 을 제외하고 order 순으로 반환한다', () => {
    const visible = visibleProfileColumns([
      { key: 'sys.browser', label: '브라우저', order: 2 },
      { key: 'sys.idx', label: '순번', order: 0 },
      { key: 'sys.ipHash', label: 'IP 해시', order: 1, hidden: true },
    ]);
    expect(visible.map((c) => c.key)).toEqual(['sys.idx', 'sys.browser']);
  });
});

describe('formatIpHash', () => {
  it('앞 8자만 반환한다', () => {
    expect(formatIpHash('abcdef1234567890')).toBe('abcdef12');
  });

  it('null·빈 문자열은 — 로 표시한다', () => {
    expect(formatIpHash(null)).toBe('—');
    expect(formatIpHash('')).toBe('—');
  });
});

describe('selectRawExportContactColumns', () => {
  it('컬럼 설정에서 표시 중인 attrs·pii 열만 설정 순서대로 고르고 sys 열은 뺀다', () => {
    const profileScheme: ProfileColumnScheme = {
      version: 1,
      columns: [
        { key: 'sys.resid', label: 'UID', order: 0 },
        { key: 'sys.idx', label: '순번', order: 1 },
        { key: 'pii.담당자', label: '성명', order: 2 },
        { key: 'attrs.지역', label: '지역', order: 3, hidden: true },
        { key: 'attrs.업체명', label: '', order: 4 },
        { key: 'sys.status', label: '상태', order: 5 },
      ],
    };
    expect(selectRawExportContactColumns(contactScheme, profileScheme)).toEqual([
      { source: 'pii.담당자', label: '성명', kind: 'pii', key: '담당자' },
      { source: 'attrs.업체명', label: '업체명', kind: 'attrs', key: '업체명' },
    ]);
  });

  it('컬럼 설정이 없으면 attrs·pii 는 기본 숨김이라 빈 배열이다', () => {
    expect(selectRawExportContactColumns(contactScheme, null)).toEqual([]);
  });

  it('컨택 스킴에서 사라진 고아 key 는 표시 중이어도 고르지 않는다', () => {
    const profileScheme: ProfileColumnScheme = {
      version: 1,
      columns: [{ key: 'attrs.사라진열', label: '사라진열', order: 0 }],
    };
    expect(selectRawExportContactColumns(contactScheme, profileScheme)).toEqual([]);
    expect(selectRawExportContactColumns(null, profileScheme)).toEqual([]);
  });
});
