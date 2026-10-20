import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  draftRowsToClauses,
  FilterBarCore,
  type FilterDraftRow,
} from '@/features/operations/filters/filter-bar-core';

// next/navigation 을 mock 하지 않는다 — 코어가 router·searchParams 를 쓰면 여기서 깨진다.

const candidates = [
  { source: 'system.resid', label: '시스템ID' },
  { source: 'attrs.기업명', label: '기업명' },
];

function Harness({
  initial,
  as,
  variant,
  onSubmit,
  onRows,
}: {
  initial: FilterDraftRow[];
  as?: 'form' | 'div';
  variant?: 'bar' | 'stack';
  onSubmit?: () => void;
  onRows?: (rows: FilterDraftRow[]) => void;
}) {
  const [rows, setRows] = useState(initial);
  return (
    <FilterBarCore
      rows={rows}
      onRowsChange={(next) => {
        setRows(next);
        onRows?.(next);
      }}
      {...(onSubmit ? { onSubmit } : {})}
      {...(as ? { as } : {})}
      {...(variant ? { variant } : {})}
      columnCandidates={candidates}
      ariaLabel="테스트 필터"
      renderValueWidget={({ value, onChange, inputId }) => (
        <input
          aria-label="값"
          {...(inputId ? { id: inputId } : {})}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    />
  );
}

describe('FilterBarCore — 제어형', () => {
  it('div 로 그리면 form 이 없다 — 다른 폼 안에 넣을 수 있다', () => {
    const { container } = render(
      <form>
        <Harness as="div" variant="stack" initial={[]} />
      </form>,
    );
    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(screen.getByRole('search', { name: '테스트 필터' }).tagName).toBe('DIV');
  });

  it('값 입력은 onRowsChange 로만 나간다', async () => {
    const user = userEvent.setup();
    const onRows = vi.fn();
    render(
      <Harness
        initial={[{ id: 'a', op: 'AND', source: 'system.resid', value: '' }]}
        onRows={onRows}
      />,
    );
    await user.type(screen.getAllByLabelText('값')[0]!, '1-3');
    const last = onRows.mock.calls.at(-1)?.[0] as FilterDraftRow[];
    expect(last[0]?.value).toBe('1-3');
  });

  it('bar 에서 조건 추가는 빈 첫 줄 뒤에 붙는다', async () => {
    const user = userEvent.setup();
    const onRows = vi.fn();
    render(<Harness initial={[]} onRows={onRows} />);
    await user.click(screen.getByRole('button', { name: /필터/ }));
    await user.click(screen.getByRole('button', { name: '+ 조건 추가' }));
    const last = onRows.mock.calls.at(-1)?.[0] as FilterDraftRow[];
    expect(last).toHaveLength(2);
    expect(last[0]?.source).toBe('system.all');
    expect(last[1]?.source).toBe('system.resid');
  });

  it('검색 버튼은 onSubmit 이 있을 때만, 누르면 onSubmit 을 부른다', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { unmount } = render(<Harness as="div" initial={[]} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: '검색' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    unmount();
    render(<Harness initial={[]} />);
    expect(screen.queryByRole('button', { name: '검색' })).toBeNull();
  });

  it('stack 은 모든 줄을 펼치고 첫 줄은 「조건」 라벨이다', () => {
    render(
      <Harness
        variant="stack"
        initial={[
          { id: 'a', op: 'AND', source: 'system.resid', value: '1-10' },
          { id: 'b', op: 'OR', source: 'attrs.기업명', value: '한빛' },
        ]}
      />,
    );
    expect(screen.getByText('조건')).toBeInTheDocument();
    expect(screen.getAllByLabelText('값')).toHaveLength(2);
  });
});

describe('draftRowsToClauses', () => {
  it('빈 값 줄을 버리고 남은 첫 줄의 op 를 비운다', () => {
    expect(
      draftRowsToClauses([
        { id: '1', op: 'AND', source: 'system.all', value: '  ' },
        { id: '2', op: 'OR', source: 'system.resid', value: ' 1-3 ' },
        { id: '3', op: 'AND', source: 'attrs.a', value: 'x' },
      ]),
    ).toEqual([
      { source: 'system.resid', value: '1-3', op: '' },
      { source: 'attrs.a', value: 'x', op: 'AND' },
    ]);
  });
});
