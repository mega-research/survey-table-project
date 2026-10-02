import { describe, expect, it } from 'vitest';

import {
  applyMobileDisplayToColumn,
  countColumnMobileDisplayTargets,
} from '@/features/survey-builder/table-editor/utils/column-mobile-display';
import { expandRepeatRows } from '@/lib/question/row-repeat';
import type { TableCell, TableRow } from '@/types/survey';

const text = (id: string, content: string, o: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'text',
  content,
  ...o,
});

// 열 0 = 제목, 열 1 = 설명(대상 열), 열 2 = 입력
const rows = (): TableRow[] => [
  { id: 'r1', label: '', cells: [text('t1', '제목1'), text('d1', '설명1'), { id: 'i1', type: 'input', content: '' }] },
  { id: 'r2', label: '', cells: [text('t2', '제목2'), text('d2', '설명2', { rowspan: 2 }), { id: 'i2', type: 'input', content: '' }] },
  { id: 'r3', label: '', cells: [text('t3', '제목3'), text('d3', '가려진 자리', { isHidden: true }), { id: 'i3', type: 'input', content: '' }] },
  { id: 'r4', label: '', cells: [text('t4', '제목4'), text('d4', ''), { id: 'i4', type: 'input', content: '' }] },
  { id: 'r5', label: '', cells: [text('t5', '제목5'), { id: 'd5', type: 'calc', content: '' }, { id: 'i5', type: 'input', content: '' }] },
  { id: 'r6', label: '', cells: [text('t6', '제목6'), { id: 'd6', type: 'image', content: '', imageUrl: 'x.png' }, { id: 'i6', type: 'input', content: '' }] },
  { id: 'r7', label: '', cells: [text('t7', '제목7'), text('d7', '설명7', { mobileDisplay: 'inline' }), { id: 'i7', type: 'input', content: '' }] },
];
const displayOf = (out: TableRow[]) =>
  Object.fromEntries(out.flatMap((r) => r.cells).map((c) => [c.id, c.mobileDisplay]));

describe('열 단위 모바일 표시 일괄 지정', () => {
  it('같은 열의 같은 유형 표시 셀에만 적용한다 — 빈 셀·가려진 자리·다른 유형은 제외', () => {
    const out = applyMobileDisplayToColumn(rows(), 'd1', 'collapsed');
    expect(displayOf(out)).toMatchObject({
      d2: 'collapsed',
      d7: 'collapsed',
      d3: undefined,
      d4: undefined,
      d5: undefined,
      d6: undefined,
      t1: undefined,
      i1: undefined,
    });
  });

  it('기준 셀 자신은 건드리지 않는다 — 그 셀은 모달 저장이 쓴다', () => {
    const out = applyMobileDisplayToColumn(rows(), 'd1', 'collapsed');
    expect(displayOf(out)['d1']).toBeUndefined();
  });

  it('값이 없으면(미지정으로 저장되는 숨기기) 대상 셀의 지정을 지운다', () => {
    const out = applyMobileDisplayToColumn(rows(), 'd1', undefined);
    const d7 = out[6]!.cells[1]!;
    expect('mobileDisplay' in d7).toBe(false);
  });

  it('대상 수는 기준 셀을 뺀 적용 대상 셀 수다', () => {
    expect(countColumnMobileDisplayTargets(rows(), 'd1')).toBe(2);
    expect(countColumnMobileDisplayTargets(rows(), 'd6')).toBe(0);
    expect(countColumnMobileDisplayTargets(rows(), '없는 셀')).toBe(0);
  });

  it('바뀌지 않은 행은 같은 객체를 돌려준다', () => {
    const input = rows();
    const out = applyMobileDisplayToColumn(input, 'd1', 'collapsed');
    expect(out[0]).toBe(input[0]);
    expect(out[1]).not.toBe(input[1]);
  });

  it('행 반복 표는 템플릿 행에 건 값이 펼쳐진 벌에도 그대로 실린다', () => {
    const config = { enabled: true, templateRowIds: ['r1'], maxRepeats: 3, addLabel: '' };
    let n = 0;
    const expanded = expandRepeatRows(rows().slice(0, 2), config, () => `gen-${++n}`);
    const applied = applyMobileDisplayToColumn(expanded, 'd2', 'collapsed');
    // 다시 펼쳐도(저장 시점 멱등 펼치기) 벌의 값이 템플릿 값으로 유지된다
    const again = expandRepeatRows(applied, config, () => `gen-${++n}`);
    expect(again.filter((row) => row.repeatSourceRowId === 'r1').map((row) => row.cells[1]!.mobileDisplay)).toEqual([
      'collapsed', 'collapsed', 'collapsed',
    ]);
  });
});
