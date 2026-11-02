import { describe, expect, it } from 'vitest';

import { pickPersonalTagColor } from './personal-marks';

// 새 태그 색 배정 (설문 즐겨찾기·태그 티켓 07) — 내 태그에서 가장 적게 쓴 색, 같으면 어휘 순서.

describe('pickPersonalTagColor', () => {
  it('태그가 하나도 없으면 어휘 첫 색(파랑)이다', () => {
    expect(pickPersonalTagColor([])).toBe('blue');
  });

  it('안 쓴 색 중 어휘 순서가 앞선 색을 고른다', () => {
    expect(pickPersonalTagColor(['blue', 'red', 'green', 'purple'])).toBe('amber');
  });

  it('모든 색을 썼으면 가장 적게 쓴 색 — 동점이면 어휘 순서', () => {
    const used = ['blue', 'red', 'green', 'purple', 'amber', 'teal', 'pink', 'gray'] as const;
    expect(pickPersonalTagColor([...used, 'blue', 'red', 'teal'])).toBe('green');
    expect(pickPersonalTagColor([...used, ...used, 'gray'])).toBe('blue');
  });
});
