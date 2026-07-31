import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';
import { resolveMobileCellLabel } from '@/utils/mobile-display-cells';

function cell(partial: Partial<TableCell>): TableCell {
  return {
    id: Math.random().toString(36).slice(2),
    content: '',
    type: 'input',
    ...partial,
  } as TableCell;
}

describe('resolveMobileCellLabel', () => {
  it('셀 라벨이 있으면 셀 라벨을 쓴다', () => {
    const target = cell({ mobileLabel: '인원수', exportLabel: 'Q10_인원수_임원' });
    expect(resolveMobileCellLabel(target, '인원수 열')).toBe('인원수');
  });

  it('셀 라벨이 없으면 엑셀 라벨로 폴백한다', () => {
    const target = cell({ exportLabel: 'Q10_인원수_임원' });
    expect(resolveMobileCellLabel(target, '인원수 열')).toBe('Q10_인원수_임원');
  });

  it('셀 라벨·엑셀 라벨이 모두 없으면 호출부 폴백을 쓴다', () => {
    expect(resolveMobileCellLabel(cell({}), '인원수 열')).toBe('인원수 열');
  });

  it('후보가 모두 없으면 빈 문자열을 돌려준다', () => {
    expect(resolveMobileCellLabel(cell({}))).toBe('');
  });

  it('공백만 있는 값은 무시하고 다음 후보로 폴백한다', () => {
    const target = cell({ mobileLabel: '   ', exportLabel: '  Q10  ' });
    expect(resolveMobileCellLabel(target, '인원수 열')).toBe('Q10');
  });

  it("mobileDisplay 가 'hidden' 이면 셀 라벨이 있어도 빈 문자열", () => {
    const target = cell({ mobileLabel: '인원수', mobileDisplay: 'hidden' });
    expect(resolveMobileCellLabel(target, '인원수 열')).toBe('');
  });
});
