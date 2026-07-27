import { describe, expect, it } from 'vitest';

import {
  RESPONSE_WIDE_TABLE_THRESHOLD_PX,
  resolveResponseContainerWidth,
} from '@/utils/table-grid-utils';

// 응답 페이지 컨테이너 폭 분기: 표 문항 페이지는 표 총폭 기준(718px 초과 → 1280px, 이하 → 896px),
// 표 없는 페이지는 좁은 폭(896px).
describe('resolveResponseContainerWidth', () => {
  const col = (width?: number) => ({ id: 'c', label: '', ...(width !== undefined ? { width } : {}) });

  it('표 문항이 없으면 max-w-4xl', () => {
    expect(resolveResponseContainerWidth([{ type: 'radio' }, { type: 'text' }])).toBe('max-w-4xl');
    expect(resolveResponseContainerWidth([])).toBe('max-w-4xl');
  });

  it('표 총폭이 718px 이하면 max-w-4xl', () => {
    expect(
      resolveResponseContainerWidth([{ type: 'table', tableColumns: [col(300), col(400)] }]),
    ).toBe('max-w-4xl');
    // 정확히 718px 도 이하로 취급
    expect(
      resolveResponseContainerWidth([{ type: 'table', tableColumns: [col(318), col(400)] }]),
    ).toBe('max-w-4xl');
  });

  it('표 총폭이 718px 초과면 max-w-7xl', () => {
    expect(
      resolveResponseContainerWidth([{ type: 'table', tableColumns: [col(319), col(400)] }]),
    ).toBe('max-w-7xl');
  });

  it('여러 표가 섞이면 가장 넓은 표 기준으로 판정한다', () => {
    expect(
      resolveResponseContainerWidth([
        { type: 'table', tableColumns: [col(200)] },
        { type: 'table', tableColumns: [col(500), col(500)] },
        { type: 'radio' },
      ]),
    ).toBe('max-w-7xl');
  });

  it('width 미지정 컬럼은 150px 로 계산한다 (calcTotalWidth 규칙)', () => {
    // 150*4 = 600 ≤ 718 → 좁게
    expect(
      resolveResponseContainerWidth([{ type: 'table', tableColumns: [col(), col(), col(), col()] }]),
    ).toBe('max-w-4xl');
    // 150*5 = 750 > 718 → 넓게
    expect(
      resolveResponseContainerWidth([
        { type: 'table', tableColumns: [col(), col(), col(), col(), col()] },
      ]),
    ).toBe('max-w-7xl');
  });

  it('threshold 상수는 718 이다', () => {
    expect(RESPONSE_WIDE_TABLE_THRESHOLD_PX).toBe(718);
  });
});
