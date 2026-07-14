import { describe, expect, it } from 'vitest';

import { getOptionsLayout } from '@/utils/options-layout';

describe('getOptionsLayout', () => {
  it('align 미지정 시 기존 클래스를 그대로 반환한다', () => {
    expect(getOptionsLayout(0).className).toBe('flex flex-wrap gap-x-4 gap-y-2');
    expect(getOptionsLayout(1).className).toBe('flex flex-col gap-2');
    expect(getOptionsLayout(undefined).className).toBe('flex flex-col gap-2');
    expect(getOptionsLayout(3).className).toBe('options-grid');
  });

  it('left 는 미지정과 동일하다', () => {
    expect(getOptionsLayout(0, 'left')).toEqual(getOptionsLayout(0));
    expect(getOptionsLayout(1, 'left')).toEqual(getOptionsLayout(1));
  });

  it('가로(0) 배치는 justify-* 로 행 전체를 정렬한다', () => {
    expect(getOptionsLayout(0, 'center').className).toBe(
      'flex flex-wrap gap-x-4 gap-y-2 justify-center',
    );
    expect(getOptionsLayout(0, 'right').className).toBe(
      'flex flex-wrap gap-x-4 gap-y-2 justify-end',
    );
  });

  it('세로(1/undefined) 배치는 w-fit + margin 으로 블록째 이동한다', () => {
    expect(getOptionsLayout(1, 'center').className).toBe('flex flex-col gap-2 w-fit mx-auto');
    expect(getOptionsLayout(undefined, 'right').className).toBe(
      'flex flex-col gap-2 w-fit ml-auto',
    );
  });

  it('N열 그리드는 align 을 무시한다', () => {
    expect(getOptionsLayout(3, 'center')).toEqual(getOptionsLayout(3));
    expect(getOptionsLayout(2, 'right')).toEqual(getOptionsLayout(2));
  });
});
