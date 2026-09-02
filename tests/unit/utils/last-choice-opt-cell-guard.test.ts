import { describe, expect, it } from 'vitest';

import type { TableRow } from '@/types/survey';
import { isLastRemainingChoiceOptCell } from '@/utils/choice-source';

// DQ7 함정 가드 — 설명 테이블의 마지막 보기 옵션 셀 판정
function rows(cells: Array<{ id: string; type: string; isHidden?: boolean }>): TableRow[] {
  return [
    { id: 'r1', label: '', cells: cells.map((c) => ({ ...c, content: '' })) },
  ] as unknown as TableRow[];
}

describe('isLastRemainingChoiceOptCell', () => {
  it('유일한 choice_opt 셀이면 true', () => {
    const r = rows([
      { id: 'c-text', type: 'text' },
      { id: 'c-opt', type: 'choice_opt' },
    ]);
    expect(isLastRemainingChoiceOptCell(r, 'c-opt')).toBe(true);
  });

  it('choice_opt 셀이 둘 이상이면 false', () => {
    const r = rows([
      { id: 'c-opt1', type: 'choice_opt' },
      { id: 'c-opt2', type: 'choice_opt' },
    ]);
    expect(isLastRemainingChoiceOptCell(r, 'c-opt1')).toBe(false);
  });

  it('자신이 choice_opt 가 아니면 false (radio 셀 등)', () => {
    const r = rows([
      { id: 'c-radio', type: 'radio' },
      { id: 'c-opt', type: 'choice_opt' },
    ]);
    expect(isLastRemainingChoiceOptCell(r, 'c-radio')).toBe(false);
  });

  it('병합 피복(isHidden) choice_opt 셀은 세지 않는다', () => {
    const r = rows([
      { id: 'c-opt', type: 'choice_opt' },
      { id: 'c-hidden', type: 'choice_opt', isHidden: true },
    ]);
    expect(isLastRemainingChoiceOptCell(r, 'c-opt')).toBe(true);
  });

  it('rows 미정의면 false', () => {
    expect(isLastRemainingChoiceOptCell(undefined, 'c-opt')).toBe(false);
  });
});
