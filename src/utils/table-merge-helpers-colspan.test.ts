import { describe, it, expect } from 'vitest';
import type { TableCell, TableColumn, TableRow } from '@/types/survey';
import {
  recalculateColspansForVisibleColumns,
  recalculateRowspansForVisibleRows,
} from '@/utils/table-merge-helpers';

// 최소 셀 팩토리 — content/type 는 TableCell 필수 필드
function cell(id: string, overrides: Partial<TableCell> = {}): TableCell {
  return { id, content: id, type: 'text', ...overrides };
}

function col(id: string, overrides: Partial<TableColumn> = {}): TableColumn {
  return { id, label: id, ...overrides };
}

describe('recalculateColspansForVisibleColumns - 가로 병합 시작 열 필터링', () => {
  it('가시 병합 시작 열이 남으면 isHeaderHidden continuation을 보존한다', () => {
    const columns = [
      col('A', { colspan: 3 }),
      col('B', { isHeaderHidden: true }),
      col('C', { isHeaderHidden: true }),
    ];
    const result = recalculateColspansForVisibleColumns(
      columns,
      [{ id: 'r1', label: '', cells: [cell('a'), cell('b'), cell('c')] }],
      new Set(['A', 'C']),
    );

    expect(result.columns[0]?.colspan).toBe(2);
    expect(result.columns[1]?.isHeaderHidden).toBe(true);
  });

  it('병합 시작 열이 빠지면 첫 가시 continuation 헤더를 승격한다', () => {
    const columns = [
      col('A', { colspan: 3 }),
      col('B', { isHeaderHidden: true }),
      col('C', { isHeaderHidden: true }),
    ];
    const result = recalculateColspansForVisibleColumns(
      columns,
      [{ id: 'r1', label: '', cells: [cell('a'), cell('b'), cell('c')] }],
      new Set(['B', 'C']),
    );

    expect(result.columns[0]?.isHeaderHidden).toBe(false);
    expect(result.columns[0]?.colspan).toBe(2);
    expect(result.columns[1]?.isHeaderHidden).toBe(true);
  });

  it('병합 시작 셀이 빠지면 첫 가시 continuation 본문 셀을 잔여 colspan 시작으로 승격한다', () => {
    const result = recalculateColspansForVisibleColumns(
      [col('A'), col('B'), col('C')],
      [
        {
          id: 'r1',
          label: '',
          cells: [
            cell('a', { colspan: 3 }),
            cell('b', { isHidden: true }),
            cell('c', { isHidden: true }),
          ],
        },
      ],
      new Set(['B', 'C']),
    );

    expect(result.rows[0]?.cells[0]).toMatchObject({
      id: 'b',
      isHidden: false,
      colspan: 2,
    });
    expect(result.rows[0]?.cells[1]).toMatchObject({
      id: 'c',
      isHidden: true,
    });
  });

  // 컬럼 [A, B, C]. A 셀이 colspan 2 로 A+B 를 가로 병합 → B 는 continuation(isHidden:true, colspan 없음).
  // A 열이 displayCondition 으로 숨겨지면 가시 열은 B, C.
  // 회귀: B(continuation)의 isHidden 이 해제되지 않아 렌더에서 if isHidden return null 로 사라지던 버그.
  it('병합 시작 셀(A)이 필터링되면 남은 continuation 셀(B)을 승격하고 isHidden을 해제한다', () => {
    const columns: TableColumn[] = [col('A'), col('B'), col('C')];
    const rows: TableRow[] = [
      {
        id: 'r1',
        label: 'r1',
        cells: [
          cell('a', { colspan: 2 }),
          cell('b', { isHidden: true }),
          cell('c'),
        ],
      },
    ];

    // A 열 숨김 → 가시 열 B, C
    const visibleColumnIds = new Set(['B', 'C']);
    const result = recalculateColspansForVisibleColumns(columns, rows, visibleColumnIds);

    expect(result.columns.map((c) => c.id)).toEqual(['B', 'C']);
    const resultRow = result.rows[0];
    expect(resultRow).toBeDefined();
    const cells = resultRow!.cells;
    expect(cells.map((c) => c.id)).toEqual(['b', 'c']);
    // 핵심 단언: continuation 이던 b 가 isHidden 해제되어 렌더된다
    expect(cells[0]!.isHidden).toBe(false);
    expect(cells[1]!.isHidden).toBeFalsy();
  });

  it('병합 시작 셀(A)이 가시로 남으면 continuation(B)은 여전히 isHidden 유지', () => {
    const columns: TableColumn[] = [col('A'), col('B'), col('C')];
    const rows: TableRow[] = [
      {
        id: 'r1',
        label: 'r1',
        cells: [
          cell('a', { colspan: 2 }),
          cell('b', { isHidden: true }),
          cell('c'),
        ],
      },
    ];

    // A, B 가시 → A 가 colspan 2 로 B 를 계속 덮음
    const visibleColumnIds = new Set(['A', 'B', 'C']);
    const result = recalculateColspansForVisibleColumns(columns, rows, visibleColumnIds);

    const cells = result.rows[0]!.cells;
    expect(cells.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(cells[0]!.colspan).toBe(2);
    expect(cells[1]!.isHidden).toBe(true); // 여전히 A 의 병합 범위 안
  });

  it('세로 병합(rowspan) continuation 은 열 필터링과 무관하게 isHidden 유지', () => {
    // (r1,A) rowspan 2 → (r2,A) continuation. A 열은 계속 가시.
    const columns: TableColumn[] = [col('A'), col('B')];
    const rows: TableRow[] = [
      {
        id: 'r1',
        label: 'r1',
        cells: [cell('a1', { rowspan: 2 }), cell('b1')],
      },
      {
        id: 'r2',
        label: 'r2',
        cells: [cell('a2', { isHidden: true }), cell('b2')],
      },
    ];

    // B 열만 숨김 → A 열은 그대로 가시
    const visibleColumnIds = new Set(['A']);
    const result = recalculateColspansForVisibleColumns(columns, rows, visibleColumnIds);

    expect(result.rows[0]!.cells[0]!.isHidden).toBeFalsy(); // 병합 시작 셀
    expect(result.rows[1]!.cells[0]!.isHidden).toBe(true); // 세로 continuation 은 유지
  });

  it('colspan 3 중 중간 열만 필터링되면 끝 열은 여전히 병합 범위 안이라 isHidden 유지', () => {
    // A colspan 3 (A,B,C). B 만 숨김 → 가시 A,C. A 는 콜스팬 2 로 재계산, C 는 여전히 A 범위.
    const columns: TableColumn[] = [col('A'), col('B'), col('C')];
    const rows: TableRow[] = [
      {
        id: 'r1',
        label: 'r1',
        cells: [
          cell('a', { colspan: 3 }),
          cell('b', { isHidden: true }),
          cell('c', { isHidden: true }),
        ],
      },
    ];

    const visibleColumnIds = new Set(['A', 'C']);
    const result = recalculateColspansForVisibleColumns(columns, rows, visibleColumnIds);

    const cells = result.rows[0]!.cells;
    expect(cells.map((c) => c.id)).toEqual(['a', 'c']);
    expect(cells[0]!.colspan).toBe(2); // 가시 열 2개 (A,C)
    expect(cells[0]!.isHidden).toBe(false);
    expect(cells[1]!.isHidden).toBe(true); // C 는 여전히 A 의 병합 범위 안
  });
});

describe('recalculateRowspansForVisibleRows - 조건부 anchor 승격 provenance', () => {
  it.each(['text', 'image', 'video'] as const)(
    'hidden %s anchor 행이 제거되면 continuation을 anchor identity와 표시 속성으로 교체한다',
    (type) => {
      const anchorId = `${type}-anchor`;
      const result = recalculateRowspansForVisibleRows(
        [
          {
            id: 'hidden-anchor-row',
            label: '숨김 행',
            cells: [cell(anchorId, {
              type,
              content: `${type} 숨김 라벨`,
              rowspan: 2,
              mobileDisplay: 'hidden',
            })],
          },
          {
            id: 'visible-continuation-row',
            label: '공개 행',
            cells: [cell(`${type}-continuation`, {
              type,
              content: '',
              isHidden: true,
              _isContinuation: true,
            })],
          },
        ],
        new Set(['visible-continuation-row']),
      );

      expect(result[0]?.cells[0]).toMatchObject({
        id: anchorId,
        type,
        content: `${type} 숨김 라벨`,
        mobileDisplay: 'hidden',
        isHidden: false,
      });
      expect(result[0]?.cells[0]).not.toHaveProperty('_isContinuation');
      expect(result[0]?.cells[0]?.rowspan ?? 1).toBe(1);
    },
  );
});
