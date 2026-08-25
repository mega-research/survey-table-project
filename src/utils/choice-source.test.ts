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
  // 스타일 축이 늘 때 이 투영을 빠뜨리면 표-소스 보기만 색을 잃는다.
  it('셀의 세 스타일 축을 모두 옵션으로 옮긴다', () => {
    const question = q({
      type: 'radio',
      tableRowsData: [row([cell({
        id: 'c1',
        type: 'choice_opt',
        choiceLabel: 'A',
        textBold: true,
        backgroundColor: '#000000',
        textColor: '#FFFFFF',
      })])],
    });

    expect(resolveChoiceOptions(question)[0]).toMatchObject({
      textBold: true,
      backgroundColor: '#000000',
      textColor: '#FFFFFF',
    });
  });

  it('스타일이 없으면 키 자체를 만들지 않는다', () => {
    const question = q({
      type: 'radio',
      tableRowsData: [row([cell({ id: 'c1', type: 'choice_opt', choiceLabel: 'A' })])],
    });

    expect(resolveChoiceOptions(question)[0]).not.toHaveProperty('textColor');
  });

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
    const opt0 = resolveChoiceOptions(question)[0];
    if (!opt0) throw new Error('resolveChoiceOptions[0] is undefined');
    expect(opt0.label).toBe('본문라벨');
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
    const opt0 = opts[0];
    const opt1 = opts[1];
    if (!opt0 || !opt1) throw new Error('opts 요소가 undefined');
    expect(opt0.spssNumericCode).toBe(1);
    expect(opt1.spssNumericCode).toBe(2);
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
    if (!opt) throw new Error('resolveChoiceOptions[0] is undefined');
    expect(opt.branchRule).toEqual(branch);
    expect(opt.allowTextInput).toBe(true);
    expect(opt.textInputPlaceholder).toBe('상세');
  });

  it('choice_opt 스타일을 파생 QuestionOption에 전달한다', () => {
    const question = q({
      tableRowsData: [
        row([
          cell({
            id: 'styled-choice',
            type: 'choice_opt',
            choiceLabel: '스타일 보기',
            textBold: true,
            backgroundColor: '#AABBCC',
          }),
        ]),
      ],
    });

    expect(resolveChoiceOptions(question)[0]).toMatchObject({
      textBold: true,
      backgroundColor: '#AABBCC',
    });
  });
});
