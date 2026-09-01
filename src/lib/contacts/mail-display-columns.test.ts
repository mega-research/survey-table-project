import { describe, expect, it } from 'vitest';

import type { ContactColumnScheme } from '@/db/schema/schema-types';

import { resolveMailDisplayColumns } from './mail-display-columns';

function schemeOf(columns: ContactColumnScheme['columns']): ContactColumnScheme {
  return { version: 1, headerRow: 1, columns };
}

describe('resolveMailDisplayColumns', () => {
  it('showInMail 이 켜진 attrs 컬럼만 order 순으로 돌려준다 — 목록 숨김(hidden)과 무관', () => {
    const scheme = schemeOf([
      { key: '회사명', label: '회사명', source: 'attrs.회사명', order: 3, showInMail: true },
      {
        key: '리스트ID',
        label: '리스트 ID',
        source: 'attrs.리스트ID',
        order: 2,
        showInMail: true,
        hidden: true,
      },
      { key: '담당자', label: '담당자', source: 'attrs.담당자', order: 4 },
    ]);

    expect(resolveMailDisplayColumns(scheme)).toEqual([
      { key: '리스트ID', label: '리스트 ID' },
      { key: '회사명', label: '회사명' },
    ]);
  });

  it('system·pii 컬럼은 플래그가 있어도 제외한다 — attrs 에 값이 없어 표시할 수 없음', () => {
    const scheme = schemeOf([
      { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1, showInMail: true },
      { key: '이메일', label: '이메일', source: 'pii.이메일', order: 2, showInMail: true },
    ]);

    expect(resolveMailDisplayColumns(scheme)).toEqual([]);
  });

  it('스킴이 없으면 빈 목록', () => {
    expect(resolveMailDisplayColumns(null)).toEqual([]);
  });
});
