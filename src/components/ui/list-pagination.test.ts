import { describe, expect, it } from 'vitest';

import { buildPageItems, parsePageJump } from './list-pagination';

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

describe('parsePageJump — 번호 입력 이동', () => {
  it('범위 안의 정수는 그 페이지다', () => {
    expect(parsePageJump('3', 10)).toBe(3);
    expect(parsePageJump(' 10 ', 10)).toBe(10);
  });

  it('범위를 넘으면 끝 페이지로, 1 미만이면 첫 페이지로 접는다', () => {
    expect(parsePageJump('99', 10)).toBe(10);
    expect(parsePageJump('0', 10)).toBe(1);
  });

  it('숫자가 아니거나 비어 있으면 이동하지 않는다', () => {
    expect(parsePageJump('', 10)).toBeNull();
    expect(parsePageJump('abc', 10)).toBeNull();
    expect(parsePageJump('2.5', 10)).toBeNull();
  });
});
