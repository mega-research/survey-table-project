import { describe, expect, it } from 'vitest';

import { buildPageItems, pageBlockNavTargets } from './table-primitives';

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

describe('pageBlockNavTargets — 이전·다음은 묶음 단위', () => {
  it('다음은 다음 묶음의 첫 페이지, 이전은 이전 묶음의 마지막 페이지다', () => {
    expect(pageBlockNavTargets(1, 47)).toEqual({ prev: null, next: 11 });
    expect(pageBlockNavTargets(7, 47)).toEqual({ prev: null, next: 11 });
    expect(pageBlockNavTargets(15, 47)).toEqual({ prev: 10, next: 21 });
    expect(pageBlockNavTargets(25, 47)).toEqual({ prev: 20, next: 31 });
  });

  it('마지막 묶음에서는 다음이 없다', () => {
    expect(pageBlockNavTargets(12, 16)).toEqual({ prev: 10, next: null });
    expect(pageBlockNavTargets(47, 47)).toEqual({ prev: 40, next: null });
  });

  it('전체가 한 묶음이면 이전·다음 모두 없다', () => {
    expect(pageBlockNavTargets(3, 10)).toEqual({ prev: null, next: null });
    expect(pageBlockNavTargets(1, 1)).toEqual({ prev: null, next: null });
  });
});
