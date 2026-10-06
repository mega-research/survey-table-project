import { useState } from 'react';

import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import type { TableCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 중복 불가 묶음 응답 화면 — 같은 묶음의 다른 칸이 고른 보기는 목록에 남되 고를 수 없다
 * (순위형 드롭다운과 같은 얼굴). 묶음은 열·행 배치와 무관하게 이름으로만 정해진다.
 */

beforeAll(() => {
  // jsdom 에는 matchMedia 가 없다 — 데스크톱 폭으로 고정한다.
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

const columns: TableColumn[] = [
  { id: 'c1', label: '2025년', width: 200 },
  { id: 'c2', label: '2026년', width: 200 },
];

const OPTIONS = [
  { id: 'o1', label: '미국', value: 'us' },
  { id: 'o2', label: '일본', value: 'jp' },
  { id: 'o3', label: '중국', value: 'cn' },
];

function select(id: string, group?: string): TableCell {
  return {
    id,
    type: 'select',
    content: '',
    selectOptions: OPTIONS,
    ...(group ? { distinctGroup: group } : {}),
  };
}

/** 연도별 묶음 — 같은 열을 따라 3행. 마지막 행의 2026년 칸은 묶음이 없다. */
const rows: TableRow[] = [
  { id: 'r1', label: '1', cells: [select('a1', '2025'), select('b1', '2026')] },
  { id: 'r2', label: '2', cells: [select('a2', '2025'), select('b2', '2026')] },
  { id: 'r3', label: '3', cells: [select('a3', '2025'), select('free')] },
];

function Harness({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  return (
    <InteractiveTableResponse
      questionId="q1"
      columns={columns}
      rows={rows}
      value={value}
      onChange={setValue}
      enableSticky={false}
    />
  );
}

function selectOf(cellId: string): HTMLSelectElement {
  return document.querySelector<HTMLSelectElement>(`[data-cell-id="${cellId}"] select`)!;
}

function optionOf(cellId: string, value: string): HTMLOptionElement {
  return selectOf(cellId).querySelector<HTMLOptionElement>(`option[value="${value}"]`)!;
}

describe('중복 불가 묶음 — 응답 화면', () => {
  it('다른 칸에서 고른 보기는 같은 묶음의 목록에 남되 비활성이다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(optionOf('a2', 'us')).toBeEnabled();

    await user.selectOptions(selectOf('a1'), 'us');

    expect(optionOf('a2', 'us')).toBeDisabled();
    expect(optionOf('a3', 'us')).toBeDisabled();
    expect(optionOf('a2', 'jp')).toBeEnabled();
  });

  it('자기가 고른 보기는 자기 목록에서 활성이다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(selectOf('a1'), 'us');
    expect(optionOf('a1', 'us')).toBeEnabled();
    expect(selectOf('a1').value).toBe('us');
  });

  it('다른 묶음과 묶음 없는 칸은 영향받지 않는다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(selectOf('a1'), 'us');

    expect(optionOf('b1', 'us')).toBeEnabled();
    expect(optionOf('free', 'us')).toBeEnabled();
  });

  it('「선택하세요」로 되돌리면 다른 칸에서 다시 고를 수 있다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ a1: 'us' }} />);
    expect(optionOf('a2', 'us')).toBeDisabled();

    await user.selectOptions(selectOf('a1'), '');

    expect(optionOf('a2', 'us')).toBeEnabled();
  });
});
