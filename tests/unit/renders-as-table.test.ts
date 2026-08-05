import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';
import { rendersAsTable } from '@/utils/renders-as-table';

// "이 문항이 응답 화면에 표로 그려지는가" 단일 판정.
// - type='table' 뿐 아니라 표-소스 radio/checkbox(choice_opt 셀)와
//   표-소스 ranking(optionsSource='table' + 컬럼/행) 도 화면에 표가 그려진다.
// - tableColumns 잔재만 있고 실제 표가 안 그려지는 문항은 false 여야 한다.
describe('rendersAsTable', () => {
  const col = (width?: number) => ({
    id: 'c',
    label: '',
    ...(width !== undefined ? { width } : {}),
  });

  const row = (cells: Array<{ type: TableCell['type']; isHidden?: boolean }>) => ({
    id: 'r',
    label: '',
    cells: cells.map((c, i): TableCell => ({ id: `cell-${i}`, content: '', ...c })),
  });

  it('type=table 은 항상 true', () => {
    expect(rendersAsTable({ type: 'table' })).toBe(true);
    expect(rendersAsTable({ type: 'table', tableColumns: [col(200)] })).toBe(true);
  });

  it('choice_opt 셀이 있는 radio/checkbox 는 true', () => {
    const rows = [row([{ type: 'text' }, { type: 'choice_opt' }])];
    expect(rendersAsTable({ type: 'radio', tableColumns: [col()], tableRowsData: rows })).toBe(true);
    expect(
      rendersAsTable({ type: 'checkbox', tableColumns: [col()], tableRowsData: rows }),
    ).toBe(true);
  });

  it('choice_opt 셀이 모두 isHidden 이면 false', () => {
    // rowspan/colspan continuation 으로 가려진 셀은 옵션이 아니다 (collectChoiceOptCells 규칙)
    const rows = [row([{ type: 'choice_opt', isHidden: true }])];
    expect(rendersAsTable({ type: 'radio', tableColumns: [col()], tableRowsData: rows })).toBe(
      false,
    );
  });

  it('choice_opt 셀 없이 tableColumns 잔재만 있는 radio 는 false', () => {
    expect(
      rendersAsTable({
        type: 'radio',
        tableColumns: [col(500), col(500)],
        tableRowsData: [row([{ type: 'text' }])],
      }),
    ).toBe(false);
  });

  it('optionsSource=table + 컬럼/행이 있는 ranking 은 true', () => {
    expect(
      rendersAsTable({
        type: 'ranking',
        rankingConfig: { positions: 3, optionsSource: 'table' },
        tableColumns: [col(300)],
        tableRowsData: [row([{ type: 'ranking_opt' }])],
      }),
    ).toBe(true);
  });

  it('optionsSource=manual 이거나 내장 표가 비어 있는 ranking 은 false', () => {
    expect(
      rendersAsTable({
        type: 'ranking',
        rankingConfig: { positions: 3, optionsSource: 'manual' },
        tableColumns: [col(300)],
        tableRowsData: [row([{ type: 'text' }])],
      }),
    ).toBe(false);
    // optionsSource=table 이지만 내장 표가 없으면 드롭다운만 그려진다
    expect(
      rendersAsTable({
        type: 'ranking',
        rankingConfig: { positions: 3, optionsSource: 'table' },
        tableRowsData: [row([{ type: 'ranking_opt' }])],
      }),
    ).toBe(false);
  });

  it('표와 무관한 문항 타입은 false', () => {
    expect(rendersAsTable({ type: 'text' })).toBe(false);
    expect(rendersAsTable({ type: 'textarea' })).toBe(false);
    expect(rendersAsTable({ type: 'notice' })).toBe(false);
    expect(rendersAsTable({ type: 'select' })).toBe(false);
  });
});
