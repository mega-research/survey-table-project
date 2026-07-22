import { describe, expect, it } from 'vitest';

import type { TableCell, TableRow } from '@/types/survey';
import {
  buildRadioGroupBuckets,
  resolveRadioGroupProps,
} from '@/utils/table-radio-groups';

function radio(
  id: string,
  overrides: Partial<TableCell> = {},
): TableCell {
  return {
    id,
    type: 'radio',
    content: '',
    radioGroupName: 'score',
    ...overrides,
  };
}

function row(cells: TableCell[]): TableRow {
  return { id: 'row-1', label: '', cells };
}

describe('table radio groups', () => {
  it('같은 행의 두 멤버는 같은 name을 공유하고 서로를 sibling으로 반환한다', () => {
    const r = row([radio('r1'), radio('r2')]);
    const buckets = buildRadioGroupBuckets(r);

    expect(resolveRadioGroupProps(r.cells[0]!, r.id, buckets)).toEqual({
      groupName: 'row-1-score',
      siblingCellIds: ['r2'],
    });
    expect(resolveRadioGroupProps(r.cells[1]!, r.id, buckets)).toEqual({
      groupName: 'row-1-score',
      siblingCellIds: ['r1'],
    });
  });

  it('단일 멤버 그룹은 일반 radio로 유지한다', () => {
    const r = row([radio('only')]);
    const buckets = buildRadioGroupBuckets(r);

    expect(resolveRadioGroupProps(r.cells[0]!, r.id, buckets)).toEqual({});
  });

  it('isHidden radio는 그룹 멤버에서 제외한다', () => {
    const r = row([radio('visible'), radio('hidden', { isHidden: true })]);

    expect(buildRadioGroupBuckets(r).get('score')).toEqual(['visible']);
  });

  it('_isContinuation radio는 그룹 멤버에서 제외한다', () => {
    const r = row([
      radio('visible'),
      radio('continuation', { _isContinuation: true }),
    ]);

    expect(buildRadioGroupBuckets(r).get('score')).toEqual(['visible']);
  });

  it.each([
    ['isHidden', radio('hidden', { isHidden: true })],
    ['_isContinuation', radio('continuation', { _isContinuation: true })],
  ])('%s 셀은 유효한 bucket을 직접 전달해도 group props를 반환하지 않는다', (_case, cell) => {
    const buckets = new Map([['score', [cell.id, 'visible']]]);

    expect(resolveRadioGroupProps(cell, 'row-1', buckets)).toEqual({});
  });
});
