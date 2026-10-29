import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 축 단위 카드의 상세 입력 — 같은 행 금액 칸이 여는 기타 내용 칸은 금액 칸 바로 아래에 선다
 * (국내전시회 문4·문5 「9) 기타비용」). 묶음 규칙은 utils/column-axis-cards.test.ts.
 */

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/features/question-renderer/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/question-renderer/contact-attrs-context')>()),
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
}));

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const columns: TableColumn[] = [
  { id: 'item', label: '', width: 300 },
  { id: 'item2', label: '', width: 100 },
  { id: 'amount', label: '응답 기재', width: 200 },
];

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '1) 숙박',
    cells: [
      { id: 'l1', type: 'text', content: '1) 숙박', colspan: 2 },
      { id: 'l1c', type: 'text', content: '', isHidden: true },
      { id: 'a1', type: 'input', content: '원', textPosition: 'right', inputType: 'number' },
    ],
  },
  {
    id: 'r9',
    label: '9) 기타비용',
    cells: [
      {
        id: 'etc',
        type: 'input',
        content: '9) 기타비용',
        colspan: 2,
        mobileLabel: '기타 내용',
        enabledWhen: { kind: 'numeric', controllerCellId: 'a9', op: '>', value: 0 },
      },
      { id: 'etc-c', type: 'text', content: '', isHidden: true },
      { id: 'a9', type: 'input', content: '원', textPosition: 'right', inputType: 'number' },
    ],
  },
];

function Harness() {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <InteractiveTableResponse
      questionId="q1"
      columns={columns}
      rows={rows}
      mobileTableDisplayMode="axis-cards"
      value={value}
      onChange={setValue}
    />
  );
}

describe('InteractiveTableResponse — 축 단위 카드 상세 입력', () => {
  it('기타 내용 칸은 따로 카드를 만들지 않고, 금액을 적으면 금액 칸 바로 아래에 열린다', () => {
    const { container } = render(<Harness />);
    expect(screen.queryByTestId('column-axis-card-item')).toBeNull();
    const card = screen.getByTestId('column-axis-card-amount');
    // 금액 전에는 상세 칸이 없고 「9) 기타비용」 글자도 한 번(행 제목)뿐이다
    expect(container.querySelector('[data-cell-id="etc"] input')).toBeNull();
    expect(within(card).getAllByText('9) 기타비용')).toHaveLength(1);

    const amount = container.querySelector('[data-cell-id="a9"] input') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '5000' } });

    const detail = container.querySelector(
      '[data-cell-id="a9"] [data-detail-cell-id="etc"] input',
    ) as HTMLInputElement;
    expect(detail).not.toBeNull();
    expect(detail.placeholder).toBe('기타 내용');
    expect(within(card).getAllByText('9) 기타비용')).toHaveLength(1);
  });

  it('같은 단일선택 묶음의 라디오 상세 칸은 하나를 고르면 다른 하나가 풀린다', () => {
    const radioRows: TableRow[] = [
      {
        id: 'r1',
        label: '1) 숙박',
        cells: [
          { id: 'l1', type: 'text', content: '1) 숙박' },
          {
            id: 'yes',
            type: 'radio',
            content: '',
            radioGroupName: 'paid',
            radioOptions: [{ id: 'o-yes', label: '선불', value: '1' }],
            enabledWhen: { kind: 'numeric', controllerCellId: 'a1', op: '>', value: 0 },
          },
          {
            id: 'no',
            type: 'radio',
            content: '',
            radioGroupName: 'paid',
            radioOptions: [{ id: 'o-no', label: '후불', value: '2' }],
            enabledWhen: { kind: 'numeric', controllerCellId: 'a1', op: '>', value: 0 },
          },
          { id: 'a1', type: 'input', content: '원', inputType: 'number' },
        ],
      },
    ];
    let latest: Record<string, unknown> = {};
    function RadioHarness() {
      const [value, setValue] = useState<Record<string, unknown>>({});
      return (
        <InteractiveTableResponse
          questionId="q1"
          columns={[
            { id: 'item', label: '' },
            { id: 'c-yes', label: '' },
            { id: 'c-no', label: '' },
            { id: 'amount', label: '응답 기재' },
          ]}
          rows={radioRows}
          mobileTableDisplayMode="axis-cards"
          value={value}
          onChange={(next) => {
            latest = next;
            setValue(next);
          }}
        />
      );
    }
    const { container } = render(<RadioHarness />);
    const amount = container.querySelector('[data-cell-id="a1"] input') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '5000' } });

    fireEvent.click(screen.getByLabelText('선불'));
    expect(latest['yes']).toBe('1');
    fireEvent.click(screen.getByLabelText('후불'));
    expect(latest['no']).toBe('2');
    expect(latest['yes']).toBe('');
  });
});
