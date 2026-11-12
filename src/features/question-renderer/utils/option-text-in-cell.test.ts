import { describe, expect, it } from 'vitest';

import type { TableRow } from '@/types/survey';

import { collectInCellOptionTextIds } from './option-text-in-cell';

const row = (cells: TableRow['cells']): TableRow => ({ id: 'r', label: '', cells });

describe('collectInCellOptionTextIds — 상세 기재를 칸 안에 그릴 보기 칸', () => {
  it('옵션을 켠 상세 기재 보기 칸만 모은다', () => {
    const ids = collectInCellOptionTextIds([
      row([
        { id: 'a', type: 'choice_opt', content: '기타', allowTextInput: true, optionTextInCell: true },
        { id: 'b', type: 'choice_opt', content: '기타2', allowTextInput: true },
        { id: 'c', type: 'choice_opt', content: '일반', optionTextInCell: true },
      ]),
    ]);
    expect([...ids]).toEqual(['a']);
  });

  it('숨은 칸과 보기 칸이 아닌 칸은 뺀다', () => {
    const ids = collectInCellOptionTextIds([
      row([
        { id: 'h', type: 'choice_opt', content: '', allowTextInput: true, optionTextInCell: true, isHidden: true },
        { id: 't', type: 'text', content: '', optionTextInCell: true },
      ]),
    ]);
    expect(ids.size).toBe(0);
  });
});
