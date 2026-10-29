import { describe, expect, it } from 'vitest';

import { resolveTableGridSizing } from '@/features/question-renderer/utils/table-grid-utils';

// 화면 폭에 맞춰 표 줄이기(fitTableToWidth): 켜면 열 폭을 비율로 바꿔 표가 좁은 화면에 맞춰 줄고,
// 넓은 화면에서는 지정한 총폭을 넘지 않는다. 끄면 기존처럼 지정 px 고정(넘치면 가로 스크롤).
describe('resolveTableGridSizing', () => {
  const col = (width?: number) => ({ id: 'c', label: '', ...(width !== undefined ? { width } : {}) });

  it('끄면 열 폭을 px 로 고정한다 (기존 동작)', () => {
    expect(resolveTableGridSizing([col(100), col(200)], false)).toEqual({
      gridTemplateColumns: '100px 200px',
      width: '300px',
      minWidth: '300px',
    });
  });

  it('켜면 열 폭 비율로 줄어들고 지정 총폭을 최대 폭으로 쓴다', () => {
    expect(resolveTableGridSizing([col(100), col(200)], true)).toEqual({
      gridTemplateColumns: 'minmax(0, 100fr) minmax(0, 200fr)',
      width: '100%',
      minWidth: 0,
      maxWidth: '300px',
    });
  });

  it('폭이 없는 열은 150 으로 본다 (calcTotalWidth 와 같은 기본값)', () => {
    expect(resolveTableGridSizing([col(), col(50)], false).gridTemplateColumns).toBe('150px 50px');
    expect(resolveTableGridSizing([col(), col(50)], true)).toMatchObject({
      gridTemplateColumns: 'minmax(0, 150fr) minmax(0, 50fr)',
      maxWidth: '200px',
    });
  });

  it('열이 없으면 끈 쪽과 같게 100% 로 둔다', () => {
    expect(resolveTableGridSizing([], false)).toEqual({ gridTemplateColumns: '', width: '100%', minWidth: '100%' });
    expect(resolveTableGridSizing([], true)).toEqual({ gridTemplateColumns: '', width: '100%', minWidth: '100%' });
  });
});
