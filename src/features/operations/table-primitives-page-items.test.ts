import { describe, expect, it } from 'vitest';

import { buildPageItems } from './table-primitives';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('buildPageItems — 10개 묶음', () => {
  it('10페이지 이하면 전부 보인다', () => {
    expect(buildPageItems(1, 1)).toEqual([1]);
    expect(buildPageItems(4, 10)).toEqual(range(1, 10));
  });

  it('첫 묶음 안에서는 1~10 과 맨 뒤를 보이고, 묶음 안에서 옮겨도 번호 줄이 그대로다', () => {
    expect(buildPageItems(1, 16)).toEqual([...range(1, 10), 'ellipsis', 16]);
    expect(buildPageItems(7, 16)).toEqual([...range(1, 10), 'ellipsis', 16]);
    expect(buildPageItems(10, 16)).toEqual([...range(1, 10), 'ellipsis', 16]);
  });

  it('다음 묶음으로 넘어가면 맨 앞을 남기고 그 묶음을 보인다', () => {
    expect(buildPageItems(11, 16)).toEqual([1, 'ellipsis', ...range(11, 16)]);
    expect(buildPageItems(16, 16)).toEqual([1, 'ellipsis', ...range(11, 16)]);
  });

  it('가운데 묶음은 맨 앞·맨 뒤를 모두 남긴다', () => {
    expect(buildPageItems(25, 47)).toEqual([1, 'ellipsis', ...range(21, 30), 'ellipsis', 47]);
  });

  it('묶음 바로 다음이 마지막 페이지면 말줄임 없이 붙인다', () => {
    expect(buildPageItems(3, 11)).toEqual([...range(1, 10), 11]);
    expect(buildPageItems(11, 11)).toEqual([1, 'ellipsis', 11]);
  });

  it('범위 밖 페이지는 가장 가까운 묶음으로 접는다', () => {
    expect(buildPageItems(0, 16)).toEqual([...range(1, 10), 'ellipsis', 16]);
    expect(buildPageItems(99, 16)).toEqual([1, 'ellipsis', ...range(11, 16)]);
  });
});
