import { describe, expect, it } from 'vitest';

import type { ContactColumnDef, ContactColumnScheme } from '@/shared/contracts/contacts';

import {
  assignDefaultSort,
  canBeDefaultSort,
  carryOverDefaultSort,
  resolveContactListSort,
  resolveDefaultSortKey,
  validateDefaultSort,
} from './default-sort';

const resid: ContactColumnDef = { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 };
const attrs = (key: string, order: number, extra: Partial<ContactColumnDef> = {}): ContactColumnDef => ({
  key,
  label: key,
  source: `attrs.${key}`,
  order,
  ...extra,
});
const pii = (key: string, order: number, extra: Partial<ContactColumnDef> = {}): ContactColumnDef => ({
  key,
  label: key,
  source: `pii.${key}`,
  order,
  piiType: 'name',
  ...extra,
});
const scheme = (columns: ContactColumnDef[]): ContactColumnScheme => ({
  version: 1,
  headerRow: 1,
  columns,
});

describe('canBeDefaultSort', () => {
  it('명단 일반 열만 된다 — 개인정보·시스템 열은 정렬 자체가 없다', () => {
    expect(canBeDefaultSort(attrs('ID', 2))).toBe(true);
    expect(canBeDefaultSort(pii('대표자', 3))).toBe(false);
    expect(canBeDefaultSort(resid)).toBe(false);
  });
});

describe('resolveDefaultSortKey', () => {
  it('지정이 없으면 시스템ID — 종전 동작 그대로', () => {
    expect(resolveDefaultSortKey(scheme([resid, attrs('ID', 2)]))).toBe('resid');
    expect(resolveDefaultSortKey(null)).toBe('resid');
    expect(resolveDefaultSortKey({ columns: undefined as never })).toBe('resid');
  });

  it('지정한 일반 열의 정렬 키를 돌려준다', () => {
    expect(resolveDefaultSortKey(scheme([resid, attrs('ID', 2, { defaultSort: true })]))).toBe(
      'attrs.ID',
    );
  });

  it('숨긴 열·개인정보 열에 남은 지정은 무시한다', () => {
    expect(
      resolveDefaultSortKey(scheme([resid, attrs('ID', 2, { defaultSort: true, hidden: true })])),
    ).toBe('resid');
    expect(resolveDefaultSortKey(scheme([resid, pii('대표자', 2, { defaultSort: true })]))).toBe(
      'resid',
    );
  });

  it('true 가 아닌 값은 지정이 아니다', () => {
    expect(
      resolveDefaultSortKey(scheme([attrs('ID', 1, { defaultSort: 'yes' as unknown as true })])),
    ).toBe('resid');
  });
});

describe('resolveContactListSort', () => {
  const s = scheme([resid, attrs('ID', 2, { defaultSort: true }), attrs('업종', 3, { hidden: true })]);

  it('주소에 정렬이 없으면 기본 정렬 열', () => {
    expect(resolveContactListSort(undefined, s)).toBe('attrs.ID');
    expect(resolveContactListSort('', s)).toBe('attrs.ID');
  });

  it('주소에 정렬이 있으면 그것이 이긴다 — 시스템ID 로 되돌릴 수 있다', () => {
    expect(resolveContactListSort('resid', s)).toBe('resid');
    expect(resolveContactListSort('webActivity', s)).toBe('webActivity');
  });

  it('주소의 정렬이 숨긴 열·모르는 키면 시스템ID 로 떨어진다(종전 가드)', () => {
    expect(resolveContactListSort('attrs.업종', s)).toBe('resid');
    expect(resolveContactListSort('nope', s)).toBe('resid');
  });

  it('지정이 없는 설문은 종전대로 시스템ID', () => {
    expect(resolveContactListSort(undefined, scheme([resid, attrs('ID', 2)]))).toBe('resid');
    expect(resolveContactListSort(undefined, null)).toBe('resid');
  });
});

describe('assignDefaultSort', () => {
  it('한 열을 켜면 다른 열의 지정은 풀린다', () => {
    const next = assignDefaultSort([resid, attrs('ID', 2, { defaultSort: true }), attrs('NO', 3)], 2);
    expect(next[1]).not.toHaveProperty('defaultSort');
    expect(next[2]).toMatchObject({ key: 'NO', defaultSort: true });
  });

  it('null 이면 전부 풀고 필드를 남기지 않는다', () => {
    const next = assignDefaultSort([resid, attrs('ID', 2, { defaultSort: true })], null);
    expect(next[1]).not.toHaveProperty('defaultSort');
  });

  it('될 수 없는 열을 고르면 아무것도 바꾸지 않는다', () => {
    const before = [resid, attrs('ID', 2, { defaultSort: true }), pii('대표자', 3)];
    expect(assignDefaultSort(before, 2)).toEqual(before);
  });
});

describe('validateDefaultSort', () => {
  it('지정이 없거나 일반 열 하나면 통과', () => {
    expect(validateDefaultSort([resid, attrs('ID', 2)])).toBeNull();
    expect(validateDefaultSort([resid, attrs('ID', 2, { defaultSort: true })])).toBeNull();
  });

  it('일반 열이 아닌 열에 걸면 거부', () => {
    expect(validateDefaultSort([pii('대표자', 1, { defaultSort: true })])).toMatch(/명단 속성/);
    expect(validateDefaultSort([{ ...resid, defaultSort: true }])).toMatch(/명단 속성/);
  });

  it('두 열에 걸면 거부', () => {
    expect(
      validateDefaultSort([attrs('ID', 1, { defaultSort: true }), attrs('NO', 2, { defaultSort: true })]),
    ).toMatch(/한 열/);
  });

  it('true 가 아닌 값은 거부', () => {
    expect(validateDefaultSort([attrs('ID', 1, { defaultSort: false as unknown as true })])).toMatch(
      /값/,
    );
  });
});

describe('carryOverDefaultSort', () => {
  it('교체 업로드로 다시 만든 스킴에 같은 이름의 일반 열이 있으면 이어받는다', () => {
    const prev = scheme([resid, attrs('ID', 2, { defaultSort: true })]);
    const next = carryOverDefaultSort(scheme([resid, attrs('업소명', 2), attrs('ID', 3)]), prev);
    expect(next.columns[2]).toMatchObject({ key: 'ID', defaultSort: true });
    expect(next.columns[1]).not.toHaveProperty('defaultSort');
  });

  it('열이 사라졌거나 개인정보 열이 됐으면 이어받지 않는다', () => {
    const prev = scheme([resid, attrs('ID', 2, { defaultSort: true })]);
    expect(carryOverDefaultSort(scheme([resid, attrs('NO', 2)]), prev).columns[1]).not.toHaveProperty(
      'defaultSort',
    );
    expect(carryOverDefaultSort(scheme([resid, pii('ID', 2)]), prev).columns[1]).not.toHaveProperty(
      'defaultSort',
    );
  });

  it('이전 스킴이 없거나 지정이 없으면 그대로', () => {
    const next = scheme([resid, attrs('ID', 2)]);
    expect(carryOverDefaultSort(next, null)).toBe(next);
    expect(carryOverDefaultSort(next, scheme([resid, attrs('ID', 2)]))).toBe(next);
  });
});
