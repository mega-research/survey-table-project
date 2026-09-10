import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FormulaExprEditor } from '@/components/survey-builder/formula/formula-expr-editor';
import type { CalcExpr, Question } from '@/types/survey';

const ownQuestion = {
  id: 'q1',
  type: 'table',
  title: 'Q1',
  required: false,
  order: 0,
  tableColumns: [],
  tableRowsData: [],
} as unknown as Question;

function renderEditor(value: CalcExpr | undefined, onChange = vi.fn()) {
  render(
    <FormulaExprEditor
      value={value}
      onChange={onChange}
      ownQuestion={ownQuestion}
      allQuestions={[]}
    />,
  );
  return onChange;
}

/**
 * 연산자를 섞으려면 그룹을 중첩해야 하는데(`년 × 12 + 월`), 그 방법이 「항 추가」 메뉴
 * 마지막 줄에 숨어 있어 곱셈 그룹에 항을 계속 더하다 `년 × 12 × 월` 이 되는 일이 있었다.
 * 구조를 만드는 동작은 값을 고르는 동작과 분리해 버튼으로 낸다.
 */
describe('수식 편집기 — 하위 그룹 버튼', () => {
  it('하위 그룹 추가가 독립 버튼으로 있다', () => {
    renderEditor(undefined);
    expect(screen.getByRole('button', { name: /하위 그룹 추가/ })).toBeInTheDocument();
  });

  it('버튼 한 번으로 하위 그룹이 항으로 들어간다', async () => {
    const onChange = renderEditor({ kind: 'group', op: '+', terms: [] });
    await userEvent.click(screen.getByRole('button', { name: /하위 그룹 추가/ }));
    const next = onChange.mock.calls.at(-1)?.[0] as CalcExpr;
    expect(next.kind).toBe('group');
    expect((next as { terms: CalcExpr[] }).terms.at(-1)?.kind).toBe('group');
  });

  it('「항 추가」 메뉴에는 하위 그룹이 더 이상 없다 — 두 곳에 두면 어느 쪽이 맞는지 흐려진다', async () => {
    renderEditor(undefined);
    await userEvent.click(screen.getByRole('button', { name: /항 추가/ }));
    expect(screen.getByRole('menuitem', { name: '셀 참조' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '하위 그룹' })).toBeNull();
  });
});
