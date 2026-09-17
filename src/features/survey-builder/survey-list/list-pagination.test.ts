import { describe, expect, it } from 'vitest';

import { buildPageItems } from './list-pagination';

describe('buildPageItems', () => {
  it('7페이지 이하는 전부 나열한다', () => {
    expect(buildPageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('가운데 페이지는 앞뒤 생략을 넣는다', () => {
    expect(buildPageItems(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]);
  });

  it('앞쪽 페이지는 앞 생략이 없다', () => {
    expect(buildPageItems(2, 10)).toEqual([1, 2, 3, 'ellipsis', 10]);
  });

  it('끝 페이지는 뒤 생략이 없다', () => {
    expect(buildPageItems(10, 10)).toEqual([1, 'ellipsis', 9, 10]);
  });
});
