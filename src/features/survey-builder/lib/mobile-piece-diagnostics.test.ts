import { describe, expect, it } from 'vitest';

import { arrangeMobilePiece } from '@/features/question-renderer/utils/mobile-piece-arrangement';
import type { HeaderCell, TableCell, TableColumn, TableRow } from '@/types/survey';

import { MOBILE_PIECE_FALLBACK_MESSAGES, diagnoseMobilePieceArrangement } from './mobile-piece-diagnostics';

const col = (id: string): TableColumn => ({ id, label: id, width: 60 });
const choice = (id: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'choice_opt',
  content: id,
  ...extra,
});
const head = (id: string, colspan: number): HeaderCell => ({ id, label: id, colspan, rowspan: 1 });

const columns = [col('item'), col('s0'), col('s1'), col('s2'), col('na')];
const scoreRow = (id: string, label: string): TableRow => ({
  id,
  label,
  cells: [
    { id: `${id}-item`, type: 'text', content: label },
    choice(`${id}-0`),
    choice(`${id}-1`),
    choice(`${id}-2`),
    choice(`${id}-na`, { excludeFromMean: true }),
  ],
});
const base = {
  columns,
  rows: [scoreRow('r1', '회원가입 절차'), scoreRow('r2', '응답 속도')],
  hideColumnLabels: false,
  omitLeadingColumns: 1,
};

describe('diagnoseMobilePieceArrangement', () => {
  it('둘 다 꺼져 있으면 아무것도 알리지 않는다', () => {
    expect(diagnoseMobilePieceArrangement(base)).toEqual([]);
    expect(
      diagnoseMobilePieceArrangement({ ...base, reverseColumns: false, columnsPerView: null }),
    ).toEqual([]);
  });

  it('적용할 수 있는 표는 켜도 알릴 것이 없다', () => {
    expect(
      diagnoseMobilePieceArrangement({ ...base, reverseColumns: true, columnsPerView: 6 }),
    ).toEqual([]);
  });

  it('점수 칸과 「평균에서 제외」 칸을 함께 덮는 머리가 있으면 반전 폴백을 행과 함께 알린다', () => {
    const issues = diagnoseMobilePieceArrangement({
      ...base,
      headerGrid: [[head('항목', 1), head('점수', 2), head('긍정+해당없음', 2)]],
      reverseColumns: true,
    });
    expect(issues).toEqual([
      {
        reason: 'merged-across-pinned',
        message: MOBILE_PIECE_FALLBACK_MESSAGES['merged-across-pinned'],
        rowLabels: ['회원가입 절차', '응답 속도'],
      },
    ]);
  });

  it('입력 칸이 섞인 행만 칸 수 폴백으로 알린다', () => {
    const etcRow: TableRow = {
      id: 'r3',
      label: '기타',
      cells: [
        { id: 'r3-item', type: 'text', content: '기타' },
        choice('r3-0'),
        choice('r3-1'),
        { id: 'r3-etc', type: 'input', content: '' },
        choice('r3-na', { excludeFromMean: true }),
      ],
    };
    const issues = diagnoseMobilePieceArrangement({
      ...base,
      rows: [...base.rows, etcRow],
      columnsPerView: 6,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ reason: 'non-choice-answer-cell', rowLabels: ['기타'] });
  });

  it('응답 화면과 같은 판정을 쓴다 — 같은 조각을 재배치 판정에 넣은 결과와 사유가 같다', () => {
    const headerGrid = [[head('항목', 1), head('점수', 2), head('긍정+해당없음', 2)]];
    const row = base.rows[0]!;
    // 앞쪽 열 하나를 뺀 조각(응답 화면이 그리는 것)
    const direct = arrangeMobilePiece(
      {
        columns: columns.slice(1),
        headerGrid: [[head('점수', 2), head('긍정+해당없음', 2)]],
        rows: [{ ...row, cells: row.cells.slice(1) }],
        interactiveRowId: row.id,
      },
      { reverseColumns: true },
    );
    const issues = diagnoseMobilePieceArrangement({ ...base, headerGrid, reverseColumns: true });
    expect(issues.map((issue) => issue.reason)).toEqual([direct.reverseFallback]);
  });
});
