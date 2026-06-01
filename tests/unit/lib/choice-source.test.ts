import { describe, expect, it } from 'vitest';

import type { Question, TableCell, TableRow } from '@/types/survey';
import {
  collectChoiceOptCells,
  isChoiceTableSource,
  resolveChoiceOptions,
} from '@/utils/choice-source';

function cell(partial: Partial<TableCell>): TableCell {
  return { id: 'c', content: '', type: 'text', ...partial } as TableCell;
}
function row(cells: TableCell[]): TableRow {
  return { id: 'r', label: '', cells };
}
function q(partial: Partial<Question>): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: 'Q',
    required: false,
    order: 0,
    ...partial,
  } as Question;
}

describe('choice-source', () => {
  it('manual 소스(choice_opt 셀 없음)는 question.options 를 그대로 반환', () => {
    const question = q({
      type: 'radio',
      options: [{ id: 'o1', label: 'A', value: 'a' }],
    });
    expect(resolveChoiceOptions(question)).toEqual([{ id: 'o1', label: 'A', value: 'a' }]);
    expect(isChoiceTableSource(question)).toBe(false);
  });

  it('choice_opt 셀이 있으면 셀에서 옵션을 수집 (value=cell.id, label=choiceLabel)', () => {
    const question = q({
      type: 'checkbox',
      tableRowsData: [
        row([
          cell({ id: 'lbl1', type: 'text', content: '컴퓨터 비전' }),
          cell({ id: 'sel1', type: 'choice_opt', choiceLabel: '컴퓨터 비전', spssNumericCode: 1 }),
        ]),
        row([
          cell({ id: 'lbl2', type: 'text', content: '음성 처리' }),
          cell({ id: 'sel2', type: 'choice_opt', choiceLabel: '음성 처리', spssNumericCode: 2 }),
        ]),
      ],
    });
    expect(isChoiceTableSource(question)).toBe(true);
    expect(resolveChoiceOptions(question)).toEqual([
      { id: 'sel1', value: 'sel1', label: '컴퓨터 비전', optionCode: undefined, spssNumericCode: 1, branchRule: undefined, allowTextInput: undefined, textInputPlaceholder: undefined },
      { id: 'sel2', value: 'sel2', label: '음성 처리', optionCode: undefined, spssNumericCode: 2, branchRule: undefined, allowTextInput: undefined, textInputPlaceholder: undefined },
    ]);
  });

  it('choiceLabel 없으면 content, 둘 다 없으면 fallback', () => {
    const question = q({
      type: 'radio',
      tableRowsData: [row([cell({ id: 's', type: 'choice_opt', content: '본문라벨' })])],
    });
    expect(resolveChoiceOptions(question)[0].label).toBe('본문라벨');
  });

  it('spssNumericCode 없으면 수집 순서 1-based 인덱스로 폴백', () => {
    const question = q({
      type: 'radio',
      tableRowsData: [
        row([cell({ id: 'a', type: 'choice_opt', choiceLabel: 'A' })]),
        row([cell({ id: 'b', type: 'choice_opt', choiceLabel: 'B' })]),
      ],
    });
    const opts = resolveChoiceOptions(question);
    expect(opts[0].spssNumericCode).toBe(1);
    expect(opts[1].spssNumericCode).toBe(2);
  });

  it('isHidden 셀(rowspan/colspan continuation)은 제외', () => {
    const question = q({
      type: 'radio',
      tableRowsData: [
        row([
          cell({ id: 'a', type: 'choice_opt', choiceLabel: 'A' }),
          cell({ id: 'b', type: 'choice_opt', choiceLabel: 'B', isHidden: true }),
        ]),
      ],
    });
    expect(collectChoiceOptCells(question.tableRowsData)).toHaveLength(1);
  });

  it('branchRule/allowTextInput/textInputPlaceholder 를 셀에서 옵션으로 전달', () => {
    const branch = { id: 'br', value: 's', action: 'end' as const };
    const question = q({
      type: 'radio',
      tableRowsData: [
        row([
          cell({
            id: 's',
            type: 'choice_opt',
            choiceLabel: 'A',
            branchRule: branch,
            allowTextInput: true,
            textInputPlaceholder: '상세',
          }),
        ]),
      ],
    });
    const opt = resolveChoiceOptions(question)[0];
    expect(opt.branchRule).toEqual(branch);
    expect(opt.allowTextInput).toBe(true);
    expect(opt.textInputPlaceholder).toBe('상세');
  });
});
