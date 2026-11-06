import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import { expandRepeatRows } from '@/lib/question/row-repeat';
import type { Question, QuestionConditionGroup, RowRepeatConfig, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 행 반복 블록 표시 조건 · 처음엔 접어 두기 — 응답 화면 (2026-11-06, .scratch/repeat-block-visibility/PRD.md).
 * 고정 행 하나 + 「품목 추가」 블록. 조건은 다른 문항(q0) 값으로 본다.
 */
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

const columns: TableColumn[] = [{ id: 'c1', label: '품목', width: 200 }];
const whenQ0Is = (v: string): QuestionConditionGroup =>
  ({
    logicType: 'AND',
    conditions: [{ id: `q0-${v}`, conditionType: 'value-match', sourceQuestionId: 'q0', requiredValues: [v] }],
  }) as QuestionConditionGroup;
const q0 = { id: 'q0', type: 'radio', title: 'q0', required: false, order: 0, options: [{ id: 'o1', label: '예', value: '1' }] } as Question;

function buildRows(config: RowRepeatConfig): TableRow[] {
  let n = 0;
  return expandRepeatRows(
    [
      { id: 'fixed', label: '원유', cells: [{ id: 'f1', content: '', type: 'input' }] },
      { id: 'tpl', label: '품목', cells: [{ id: 't1', content: '', type: 'input' }] },
    ],
    config,
    () => `gen${++n}`,
  );
}

function Harness({ config, q0Value, initial = {} }: { config: RowRepeatConfig; q0Value?: string; initial?: Record<string, unknown> }) {
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  const rows = buildRows(config);
  const table = { id: 'q1', type: 'table', title: 't', required: false, order: 1, tableRowsData: rows } as Question;
  return (
    <InteractiveTableResponse
      questionId="q1"
      columns={columns}
      rows={rows}
      rowRepeatConfig={config}
      value={value}
      onChange={setValue}
      enableSticky={false}
      allResponses={{ ...(q0Value ? { q0: q0Value } : {}), q1: value }}
      allQuestions={[q0, table]}
    />
  );
}

const base: RowRepeatConfig = { enabled: true, templateRowIds: ['tpl'], maxRepeats: 3, addLabel: '품목 추가' };

describe('블록 표시 조건', () => {
  it('조건이 거짓이면 블록 줄과 「품목 추가」 버튼이 모두 사라지고 고정 줄만 남는다', () => {
    render(<Harness config={{ ...base, displayCondition: whenQ0Is('1') }} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /품목 추가/ })).toBeNull();
  });

  it('조건이 참이면 블록 첫 줄과 버튼이 보인다', () => {
    render(<Harness config={{ ...base, displayCondition: whenQ0Is('1') }} q0Value="1" />);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /품목 추가/ })).toBeTruthy();
  });
});

describe('처음엔 접어 두기', () => {
  it('첫 줄도 접혀 버튼만 보이고, 누르면 첫 줄이 열린다', async () => {
    render(<Harness config={{ ...base, startCollapsed: true }} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /품목 추가/ }));
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('펼쳐 둘 조건이 참이면 처음부터 첫 줄이 보인다', () => {
    render(<Harness config={{ ...base, startCollapsed: true, expandWhen: whenQ0Is('1') }} q0Value="1" />);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('값이 든 첫 줄은 접혀 있지 않다', () => {
    render(<Harness config={{ ...base, startCollapsed: true }} initial={{ t1: '버터' }} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });
});
