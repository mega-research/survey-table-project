import { describe, expect, it } from 'vitest';

import { describeCellCondition } from '@/features/survey-builder/utils/describe-cell-condition';
import type { TableCell, TableRow } from '@/types/survey';

const cell = (id: string, extra: Partial<TableCell> = {}): TableCell =>
  ({ id, type: 'input', content: '', ...extra }) as TableCell;

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: [
      cell('t1', { type: 'text', content: '(3) 설립연도' }),
      cell('y', { exportLabel: '설립연도_년' }),
      cell('m', { exportLabel: '설립연도_월' }),
      cell('t2', { type: 'text', content: '(8) 법인등록번호' }),
      cell('corp'),
      cell('kind', {
        type: 'radio',
        exportLabel: '상장 여부',
        radioOptions: [
          { id: 'o1', label: '상장', value: '1' },
          { id: 'o2', label: '비상장', value: '2' },
        ],
      }),
    ],
  },
] as TableRow[];

describe('describeCellCondition', () => {
  it('숫자 조건 AND 묶음을 엑셀 라벨로 읽는다', () => {
    expect(
      describeCellCondition(
        {
          kind: 'group',
          op: 'AND',
          terms: [
            { kind: 'numeric', controllerCellId: 'y', op: '!=', value: 9999 },
            { kind: 'numeric', controllerCellId: 'm', op: '!=', value: 99 },
          ],
        },
        rows,
      ),
    ).toBe('설립연도_년 ≠ 9999 그리고 설립연도_월 ≠ 99');
  });

  it('엑셀 라벨이 없으면 같은 행 앞 글자 칸 이름을 쓴다', () => {
    expect(describeCellCondition({ kind: 'filled', controllerCellId: 'corp' }, rows)).toBe(
      '(8) 법인등록번호 입력함',
    );
  });

  it('보기 조건은 보기 이름으로, 중첩 묶음은 괄호로 읽는다', () => {
    expect(
      describeCellCondition(
        {
          kind: 'group',
          op: 'OR',
          terms: [
            { kind: 'option', controllerCellId: 'kind', values: ['1'] },
            {
              kind: 'group',
              op: 'AND',
              terms: [
                { kind: 'numeric', controllerCellId: 'y', op: '>=', value: 2000 },
                { kind: 'numeric', controllerCellId: 'm', op: '<=', value: 6 },
              ],
            },
          ],
        },
        rows,
      ),
    ).toBe('상장 여부 = 「상장」 또는 (설립연도_년 ≥ 2000 그리고 설립연도_월 ≤ 6)');
  });

  it('NOT 묶음과 지워진 칸을 읽는다', () => {
    expect(
      describeCellCondition(
        {
          kind: 'group',
          op: 'NOT',
          terms: [{ kind: 'filled', controllerCellId: 'gone' }],
        },
        rows,
      ),
    ).toBe('다음 중 하나도 아님((지워진 칸) 입력함)');
  });
});
