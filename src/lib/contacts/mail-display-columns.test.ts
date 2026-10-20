import { describe, expect, it } from 'vitest';

import type { ContactColumnDef, ContactColumnScheme } from '@/shared/contracts/contacts';

import {
  canShowInMail,
  mailColumnValue,
  mailPiiMaskKeys,
  resolveMailDisplayColumns,
  resolveMailShowsResid,
  toggleShowInMail,
} from './mail-display-columns';

function schemeOf(columns: ContactColumnScheme['columns']): ContactColumnScheme {
  return { version: 1, headerRow: 1, columns };
}

const resid: ContactColumnDef = { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 };

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
      { key: '리스트ID', label: '리스트 ID', kind: 'attrs' },
      { key: '회사명', label: '회사명', kind: 'attrs' },
    ]);
  });

  it('개인정보 열도 켜면 순서 자리에 pii 로 들어온다', () => {
    const scheme = schemeOf([
      { key: '회사명', label: '회사명', source: 'attrs.회사명', order: 3, showInMail: true },
      { key: '대표자명', label: '대표자', source: 'pii.대표자명', order: 2, piiType: 'name', showInMail: true },
      { key: '이메일', label: '이메일', source: 'pii.이메일', order: 4, piiType: 'email' },
    ]);

    const columns = resolveMailDisplayColumns(scheme);
    expect(columns).toEqual([
      { key: '대표자명', label: '대표자', kind: 'pii' },
      { key: '회사명', label: '회사명', kind: 'attrs' },
    ]);
    expect(mailPiiMaskKeys(columns)).toEqual(['대표자명']);
  });

  it('시스템ID·운영 컬럼은 목록에 넣지 않는다 — 시스템ID 는 맨 앞 고정 열', () => {
    const scheme = schemeOf([
      { ...resid, showInMail: true },
      { key: 'web', label: 'web', source: 'system.web', order: 2, showInMail: true },
    ]);

    expect(resolveMailDisplayColumns(scheme)).toEqual([]);
  });

  it('컨택원 열은 includeContactOwner 를 켠 호출에만 나온다 — 게스트 화면은 켜 두어도 없다', () => {
    const scheme = schemeOf([
      { key: '회사명', label: '회사명', source: 'attrs.회사명', order: 2, showInMail: true },
      {
        key: 'contact_owner',
        label: '컨택원',
        source: 'system.contact_owner',
        order: 1,
        showInMail: true,
      },
    ]);

    expect(resolveMailDisplayColumns(scheme)).toEqual([
      { key: '회사명', label: '회사명', kind: 'attrs' },
    ]);
    expect(resolveMailDisplayColumns(scheme, { includeContactOwner: true })).toEqual([
      { key: 'contact_owner', label: '컨택원', kind: 'owner' },
      { key: '회사명', label: '회사명', kind: 'attrs' },
    ]);
  });

  it('스킴이 없으면 빈 목록', () => {
    expect(resolveMailDisplayColumns(null)).toEqual([]);
  });
});

describe('resolveMailShowsResid', () => {
  it('끄지 않았으면 보이고, showInMail: false 면 숨는다', () => {
    expect(resolveMailShowsResid(schemeOf([resid]))).toBe(true);
    expect(resolveMailShowsResid(schemeOf([{ ...resid, showInMail: false }]))).toBe(false);
    expect(resolveMailShowsResid(schemeOf([]))).toBe(true);
    expect(resolveMailShowsResid(null)).toBe(true);
  });
});

describe('toggleShowInMail', () => {
  it('시스템ID 는 끄면 false 가 남고 다시 켜면 필드가 사라진다', () => {
    const off = toggleShowInMail(resid);
    expect(off).toMatchObject({ showInMail: false });
    expect(toggleShowInMail(off)).not.toHaveProperty('showInMail');
  });

  it('attrs·pii 열은 켜면 true 가 남고 끄면 필드가 사라진다', () => {
    const col: ContactColumnDef = { key: '대표자명', label: '대표자명', source: 'pii.대표자명', order: 2 };
    const on = toggleShowInMail(col);
    expect(on).toMatchObject({ showInMail: true });
    expect(toggleShowInMail(on)).not.toHaveProperty('showInMail');
  });
});

describe('canShowInMail', () => {
  it('attrs·pii·시스템ID·컨택원만 — 그 밖의 운영 컬럼은 아니다', () => {
    expect(canShowInMail({ source: 'attrs.회사명' })).toBe(true);
    expect(canShowInMail({ source: 'pii.이메일' })).toBe(true);
    expect(canShowInMail({ source: 'system.resid' })).toBe(true);
    expect(canShowInMail({ source: 'system.contact_owner' })).toBe(true);
    expect(canShowInMail({ source: 'system.contact_result' })).toBe(false);
  });
});

describe('mailColumnValue', () => {
  it('kind 에 따라 attrs 또는 마스킹 힌트를 읽고, 없으면 빈 문자열', () => {
    const attrs = { 회사명: '메가' };
    const masks = { 대표자명: '김*수' };
    expect(mailColumnValue({ key: '회사명', label: '', kind: 'attrs' }, attrs, masks)).toBe('메가');
    expect(mailColumnValue({ key: '대표자명', label: '', kind: 'pii' }, attrs, masks)).toBe('김*수');
    expect(mailColumnValue({ key: '없음', label: '', kind: 'pii' }, attrs, masks)).toBe('');
    const owner = { key: 'contact_owner', label: '', kind: 'owner' } as const;
    expect(mailColumnValue(owner, attrs, masks, '이메일 갱신')).toBe('이메일 갱신');
    expect(mailColumnValue(owner, attrs, masks, null)).toBe('');
  });
});
