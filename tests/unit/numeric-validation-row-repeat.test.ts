import { describe, expect, it } from 'vitest';

import { expandRepeatRows } from '@/lib/question/row-repeat';
import { collectNumericIssues } from '@/lib/survey/numeric-validation';
import type { Question, RowRepeatConfig, TableRow } from '@/types/survey';

/**
 * 필수 검증은 1벌만 본다. 2벌부터는 열어도 비워 둘 수 있다 — 실수로 `+` 를 누른
 * 응답자가 제출하지 못하는 상황을 막는다. 범위·합계 검증은 벌 수와 무관하다.
 */

const config: RowRepeatConfig = { enabled: true, templateRowIds: ['tpl'], maxRepeats: 3 };

function repeatQuestion(): Question {
  const seed: TableRow[] = [
    {
      id: 'tpl',
      label: '성과',
      cells: [
        {
          id: 't1',
          type: 'input',
          content: '',
          required: true,
          requiredMessage: '성과명을 적어주세요.',
        },
        { id: 't2', type: 'input', content: '', inputType: 'number', numberFormat: { max: 10 } },
      ],
    },
  ] as TableRow[];
  let n = 0;
  return {
    id: 'q1',
    type: 'table',
    title: '표',
    required: false,
    order: 0,
    tableColumns: [{ id: 'c1', label: '성과명' }, { id: 'c2', label: '수' }],
    tableRowsData: expandRepeatRows(seed, config, () => `gen${++n}`),
    rowRepeatConfig: config,
  } as Question;
}

function bundle(question: Question, index: number): TableRow {
  return question.tableRowsData!.find((r) => r.repeatIndex === index)!;
}

describe('행 반복 — 필수 검증은 1벌만 본다', () => {
  it('1벌 필수 셀이 비면 막는다', () => {
    const q = repeatQuestion();
    const first = bundle(q, 1);
    const issues = collectNumericIssues(q, { [first.cells[1]!.id]: '3' }, undefined);
    expect(issues.map((i) => i.kind)).toContain('required-cells');
  });

  it('1벌만 채우면 통과한다 — 2벌·3벌 필수 셀은 비어 있어도 된다', () => {
    const q = repeatQuestion();
    const first = bundle(q, 1);
    const issues = collectNumericIssues(q, { [first.cells[0]!.id]: '논문' }, undefined);
    expect(issues).toEqual([]);
  });

  it('2벌에 값을 넣어도 그 벌의 다른 필수 셀을 강요하지 않는다', () => {
    const q = repeatQuestion();
    const first = bundle(q, 1);
    const second = bundle(q, 2);
    const issues = collectNumericIssues(
      q,
      { [first.cells[0]!.id]: '논문', [second.cells[1]!.id]: '2' },
      undefined,
    );
    expect(issues).toEqual([]);
  });

  it('범위 검증은 2벌 이후에도 그대로 걸린다', () => {
    const q = repeatQuestion();
    const first = bundle(q, 1);
    const third = bundle(q, 3);
    const issues = collectNumericIssues(
      q,
      { [first.cells[0]!.id]: '논문', [third.cells[1]!.id]: '999' },
      undefined,
    );
    expect(issues.map((i) => i.kind)).toEqual(['range']);
  });

  it('반복이 아닌 표의 필수 셀 판정은 그대로다', () => {
    const q = {
      id: 'q2',
      type: 'table',
      title: '표',
      required: false,
      order: 0,
      tableColumns: [{ id: 'c1', label: '열' }],
      tableRowsData: [
        { id: 'r1', label: '', cells: [{ id: 'a1', type: 'input', content: '', required: true }] },
        { id: 'r2', label: '', cells: [{ id: 'a2', type: 'input', content: '', required: true }] },
      ],
    } as unknown as Question;
    const issues = collectNumericIssues(q, { a1: '값' }, undefined);
    expect(issues.map((i) => i.kind)).toContain('required-cells');
  });
});
