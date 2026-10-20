import { describe, expect, it } from 'vitest';

import {
  LIST_QUERY_PARAM,
  contactDetailHref,
  contactsListHref,
  listQueryFromSearchParams,
} from './contacts-list-return';

const CONTACTS = '/surveys/sv-1/operations/contacts';

describe('contacts-list-return', () => {
  it('목록 쿼리를 단건 주소에 실었다가 그대로 목록 주소로 되돌린다', () => {
    const listQuery = 'page=3&sort=resid&dir=desc&col=attrs.지원연도&q=2024';
    const detail = contactDetailHref(CONTACTS, 'ct-1', listQuery);
    expect(detail.startsWith('/surveys/sv-1/operations/contacts/ct-1?')).toBe(true);

    const carried = new URL(detail, 'http://x').searchParams.get(LIST_QUERY_PARAM);
    expect(carried).toBe(listQuery);
    expect(contactsListHref(CONTACTS, carried)).toBe(
      `/surveys/sv-1/operations/contacts?${listQuery}`,
    );
  });

  it('목록 쿼리가 없으면 쿼리 없는 주소다 — 첫 페이지 목록', () => {
    expect(contactDetailHref(CONTACTS, 'ct-1', '')).toBe('/surveys/sv-1/operations/contacts/ct-1');
    expect(contactsListHref(CONTACTS, null)).toBe('/surveys/sv-1/operations/contacts');
  });

  it('경로는 고정이라 쿼리에 다른 주소를 넣어도 목록 밖으로 나가지 않는다', () => {
    expect(contactsListHref(CONTACTS, '//evil.example/x')).toBe(
      '/surveys/sv-1/operations/contacts?//evil.example/x',
    );
  });

  it('RSC searchParams 의 배열 값은 같은 키로 반복한다', () => {
    expect(
      listQueryFromSearchParams({ col: ['attrs.a', 'attrs.b'], q: ['1', '2'], page: '2', sort: undefined }),
    ).toBe('col=attrs.a&col=attrs.b&q=1&q=2&page=2');
  });
});
