import { describe, expect, it } from 'vitest';

import type { TableCell, TableColumn, TableRow } from '@/types/survey';
import { buildMobileRowWiseOriginalModel } from '@/features/question-renderer/utils/mobile-row-wise-original';

const columns: TableColumn[] = [
  { id: 'section', label: '구분' },
  { id: 'item', label: '문항' },
  { id: 'score-a', label: 'A', width: 180 },
  { id: 'score-b', label: 'B', width: 180 },
];

function text(id: string, content: string, overrides: Partial<TableCell> = {}): TableCell {
  return { id, type: 'text', content, ...overrides };
}

function input(id: string, placeholder: string, overrides: Partial<TableCell> = {}): TableCell {
  return { id, type: 'input', content: '', placeholder, ...overrides };
}

const repeatedRow: TableRow = {
  id: 'repeat',
  label: '반복 기준',
  cells: [
    text('repeat-section', '반복 기준'),
    text('repeat-item', '척도 설명'),
    input('repeat-a', '반복 A'),
    input('repeat-b', '반복 B'),
  ],
};

const firstRow: TableRow = {
  id: 'row-1',
  label: '직무',
  cells: [
    text('section-anchor', '취업 현황', { rowspan: 2 }),
    text('item-1', '직무'),
    input('answer-1', '직무 A'),
    input('answer-1-empty', '직무 B', { isHidden: true }),
  ],
};

const secondRow: TableRow = {
  id: 'row-2',
  label: '진로',
  cells: [
    text('section-continuation', '', { isHidden: true, _isContinuation: true }),
    text('item-2', '진로'),
    input('answer-2-empty', '진로 A', { isHidden: true }),
    input('answer-2', '진로 B'),
  ],
};

describe('buildMobileRowWiseOriginalModel', () => {
  it('반복 행을 제외하고 선택 순서와 무관하게 작성 순서·원본 열 좌표로 행 문항을 투영한다', () => {
    const model = buildMobileRowWiseOriginalModel({
      authoredColumns: columns,
      authoredRows: [repeatedRow, firstRow, secondRow],
      visibleColumns: columns,
      displayRows: [secondRow, repeatedRow, firstRow],
      hideColumnLabels: false,
      settings: {
        omitLeadingAuthoredColumns: 2,
        repeatHeaderStartRow: 1,
        repeatHeaderEndRow: 1,
      },
    });

    expect(model.sections).toHaveLength(1);
    expect(model.sections[0]?.label).toBe('취업 현황');
    expect(model.sections[0]?.subgroups.map((group) => group.label)).toEqual(['직무', '진로']);

    const questions = model.sections[0]?.subgroups.flatMap((group) => group.questions) ?? [];
    expect(questions.map((question) => question.rowId)).toEqual(['row-1', 'row-2']);
    expect(questions.map((question) => question.title)).toEqual(['직무', '진로']);
    expect(questions.map((question) => question.projection.columns.map((column) => column.id)))
      .toEqual([
        ['score-a', 'score-b'],
        ['score-a', 'score-b'],
      ]);
    expect(questions[0]?.projection.row.cells.map((cell) => cell.id)).toEqual([
      'answer-1',
      'answer-1-empty',
    ]);
    expect(questions[1]?.projection.row.cells.map((cell) => cell.id)).toEqual([
      'answer-2-empty',
      'answer-2',
    ]);
    expect(
      questions.map((question) => question.projection.repeatedRows.map((row) => row.id)),
    ).toEqual([['repeat'], ['repeat']]);
  });

  it('응답 가능한 셀이 모두 숨은 행과 가시하지 않은 반복 행을 제외한다', () => {
    const hiddenRow: TableRow = {
      id: 'hidden-row',
      label: '숨김',
      cells: [
        text('hidden-section', '숨김 섹션'),
        text('hidden-item', '숨김 문항'),
        input('hidden-answer-a', '숨김 A', { isHidden: true }),
        input('hidden-answer-b', '숨김 B', { isHidden: true }),
      ],
    };

    const model = buildMobileRowWiseOriginalModel({
      authoredColumns: columns,
      authoredRows: [repeatedRow, firstRow, hiddenRow],
      visibleColumns: columns,
      displayRows: [firstRow, hiddenRow],
      hideColumnLabels: false,
      settings: {
        omitLeadingAuthoredColumns: 2,
        repeatHeaderStartRow: 1,
        repeatHeaderEndRow: 1,
      },
    });

    const questions = model.sections.flatMap((section) =>
      section.subgroups.flatMap((group) => group.questions),
    );
    expect(questions).toHaveLength(1);
    expect(questions[0]?.rowId).toBe('row-1');
    expect(questions[0]?.projection.repeatedRows).toEqual([]);
  });

  it('rowspan 입력의 continuation 행도 같은 논리 셀을 가진 독립 행 문항으로 만든다', () => {
    const mergedColumns: TableColumn[] = [
      { id: 'merged-label', label: '문항' },
      { id: 'merged-answer', label: '공유 응답' },
    ];
    const mergedRows: TableRow[] = [
      {
        id: 'merged-row-1',
        label: '첫 행',
        cells: [
          text('merged-label-1', '첫 행'),
          input('shared-input', '공유 응답', { rowspan: 2 }),
        ],
      },
      {
        id: 'merged-row-2',
        label: '둘째 행',
        cells: [
          text('merged-label-2', '둘째 행'),
          input('shared-input-continuation', '', {
            isHidden: true,
            _isContinuation: true,
          }),
        ],
      },
    ];

    const model = buildMobileRowWiseOriginalModel({
      authoredColumns: mergedColumns,
      authoredRows: mergedRows,
      visibleColumns: mergedColumns,
      displayRows: mergedRows,
      hideColumnLabels: false,
      settings: { omitLeadingAuthoredColumns: 1 },
    });
    const questions = model.sections.flatMap((section) =>
      section.subgroups.flatMap((group) => group.questions),
    );

    expect(questions.map((question) => question.rowId)).toEqual([
      'merged-row-1',
      'merged-row-2',
    ]);
    expect(questions.map((question) => question.projection.row.cells[0]?.id)).toEqual([
      'shared-input',
      'shared-input',
    ]);
  });
});
