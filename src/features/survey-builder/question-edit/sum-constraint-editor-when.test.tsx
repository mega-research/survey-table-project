import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SumConstraintEditor } from '@/features/survey-builder/question-edit/sum-constraint-editor';
import type { Question, SumConstraint, TableColumn, TableRow } from '@/types/survey';

const columns: TableColumn[] = [
  { id: 'c1', label: '' },
  { id: 'c2', label: '' },
] as TableColumn[];
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: [
      { id: 'y', type: 'input', content: '', inputType: 'number', exportLabel: '설립연도_년' },
      { id: 'm', type: 'input', content: '', inputType: 'number', exportLabel: '설립연도_월' },
    ],
  },
] as TableRow[];

const constraint: SumConstraint = {
  id: 'k1',
  cellIds: ['y'],
  operator: 'lte',
  target: 2026,
  when: {
    kind: 'group',
    op: 'AND',
    terms: [
      { kind: 'numeric', controllerCellId: 'y', op: '!=', value: 9999 },
      { kind: 'numeric', controllerCellId: 'm', op: '!=', value: 99 },
    ],
  },
};

describe('SumConstraintEditor 적용 조건 표시', () => {
  it('스크립트로 넣은 칸 조건을 칸 이름으로 풀어 보인다', async () => {
    const question = {
      id: 'q1',
      type: 'table',
      title: 'Q1',
      required: false,
      order: 0,
      tableColumns: columns,
      tableRowsData: rows,
    } as Question;
    render(
      <SumConstraintEditor
        constraints={[constraint]}
        tableColumns={columns}
        tableRowsData={rows}
        ownQuestion={question}
        allQuestions={[question]}
        onUpdate={() => {}}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: '규칙 펼치기' }));
    expect(
      screen.getByText(/적용 조건: 설립연도_년 ≠ 9999 그리고 설립연도_월 ≠ 99 일 때만 검사합니다/),
    ).toBeInTheDocument();
  });
});
