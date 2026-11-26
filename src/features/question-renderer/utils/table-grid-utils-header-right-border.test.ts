import { describe, expect, it } from 'vitest';

import { getHeaderRightBorderClass } from '@/features/question-renderer/utils/table-grid-utils';

describe('getHeaderRightBorderClass — 머리글 칸의 오른쪽 세로선 숨김', () => {
  it('켠 머리글 칸은 오른쪽 선을 지우는 클래스를 받는다', () => {
    expect(getHeaderRightBorderClass({ hideRightBorder: true }, 1, 5)).toBe('border-r-0');
    // 여러 열을 덮는 칸은 덮는 마지막 열로 본다
    expect(getHeaderRightBorderClass({ hideRightBorder: true }, 4, 5)).toBe('border-r-0');
  });

  it('켜지 않은 칸은 선을 그대로 둔다', () => {
    expect(getHeaderRightBorderClass({}, 1, 5)).toBeUndefined();
    expect(getHeaderRightBorderClass({ hideRightBorder: false }, 1, 5)).toBeUndefined();
  });

  it('표의 마지막 열에 닿는 칸은 켜도 지우지 않는다 — 표의 오른쪽 끝선이다', () => {
    expect(getHeaderRightBorderClass({ hideRightBorder: true }, 5, 5)).toBeUndefined();
    // 표시 조건으로 열이 줄어 마지막 열이 된 칸도 같다
    expect(getHeaderRightBorderClass({ hideRightBorder: true }, 3, 3)).toBeUndefined();
  });
});
