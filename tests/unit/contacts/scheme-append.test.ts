import { describe, expect, it } from 'vitest';

import type { ContactColumnScheme, ContactUploadMapping } from '@/db/schema/schema-types';
import { appendNewColumnsToScheme, getSchemeRouting } from '@/lib/contacts/scheme-helpers';

function baseScheme(): ContactColumnScheme {
  return {
    version: 1,
    headerRow: 2,
    columns: [
      { key: 'resid', label: '번호', source: 'system.resid', order: 1 },
      { key: 'idx', label: '번호표', source: 'attrs.idx', order: 2 },
      { key: '이메일', label: '이메일', source: 'pii.이메일', order: 3, piiType: 'email' },
      { key: 'contact_result', label: '컨택결과', source: 'system.contact_result', order: 4 },
      { key: 'email_count', label: '메일', source: 'system.email_count', order: 5 },
      { key: 'web', label: 'web', source: 'system.web', order: 6 },
      { key: 'contact_owner', label: '컨택원', source: 'system.contact_owner', order: 7 },
    ],
  };
}

function mapping(overrides: Partial<ContactUploadMapping> = {}): ContactUploadMapping {
  return {
    systemFields: {},
    selectedAttrsKeys: [],
    headerRow: 2,
    sheetName: 'Sheet1',
    ...overrides,
  };
}

describe('getSchemeRouting', () => {
  it('스킴에서 pii/attrs 키를 추출한다', () => {
    const r = getSchemeRouting(baseScheme());
    expect(r.piiByKey).toEqual({ 이메일: 'email' });
    expect(r.knownAttrKeys).toEqual(new Set(['idx']));
  });

  it('null 스킴은 빈 라우팅', () => {
    const r = getSchemeRouting(null);
    expect(r.piiByKey).toEqual({});
    expect(r.knownAttrKeys.size).toBe(0);
  });
});

describe('appendNewColumnsToScheme', () => {
  it('신규 헤더만 운영 컬럼 앞에 삽입하고 기존 컬럼은 보존한다', () => {
    const next = appendNewColumnsToScheme(
      baseScheme(),
      ['idx', '이메일', '신규컬럼'],
      mapping({ selectedAttrsKeys: ['신규컬럼'] }),
    );
    const keys = next.columns.map((c) => c.key);
    expect(keys).toEqual([
      'resid', 'idx', '이메일', '신규컬럼',
      'contact_result', 'email_count', 'web', 'contact_owner',
    ]);
    const added = next.columns.find((c) => c.key === '신규컬럼');
    expect(added?.source).toBe('attrs.신규컬럼');
    expect(added?.hidden).toBe(false);
    // order 는 1부터 연속 재부여
    expect(next.columns.map((c) => c.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // 기존 컬럼 라벨 보존
    expect(next.columns.find((c) => c.key === 'idx')?.label).toBe('번호표');
  });

  it('신규 PII 헤더는 pii 소스 + piiType 으로 등록된다', () => {
    const next = appendNewColumnsToScheme(
      baseScheme(),
      ['휴대폰'],
      mapping({ piiMapping: { 휴대폰: 'mobile' } }),
    );
    const added = next.columns.find((c) => c.key === '휴대폰');
    expect(added?.source).toBe('pii.휴대폰');
    expect(added?.piiType).toBe('mobile');
    expect(added?.hidden).toBe(true); // selectedAttrsKeys 에 없음
  });

  it('신규 헤더가 없으면 스킴이 그대로다', () => {
    const next = appendNewColumnsToScheme(baseScheme(), ['idx', '이메일'], mapping());
    expect(next).toEqual(baseScheme());
  });
});
