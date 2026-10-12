import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 항목 단위 카드 — 한 행에 「라벨 + 입력」 쌍이 여럿 놓인 양식형 표가 모바일에서 라벨마다 카드
 * 하나로 선다. 묶음 규칙 자체는 utils/item-cards.test.ts 가 지키고, 여기는 응답 화면 배선
 * (제목·입력·값 쓰기·오류 표식)을 본다.
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
  { id: 'c1', label: '라벨1', width: 180 },
  { id: 'c2', label: '년도1', width: 139 },
  { id: 'c3', label: '월1', width: 139 },
  { id: 'c4', label: '라벨2', width: 180 },
  { id: 'c5', label: '라벨3', width: 180 },
  { id: 'c6', label: '년도2', width: 139 },
  { id: 'c7', label: '월2', width: 139 },
];

const rows: TableRow[] = [
  {
    id: 'r2',
    label: '설립연도/기획_개발_시점',
    cells: [
      { id: 'found', type: 'text', content: '(3) 설립연도', rowspan: 2 },
      { id: 'found-y', type: 'input', content: '년', rowspan: 2, exportLabel: '설립연도_년' },
      { id: 'found-m', type: 'input', content: '월', rowspan: 2, exportLabel: '설립연도_월' },
      { id: 'ai', type: 'text', content: '(4) 인공지능 시작연도', rowspan: 2 },
      { id: 'plan', type: 'text', content: '(4-1) 기획/개발 시점' },
      { id: 'plan-y', type: 'input', content: '년', exportLabel: '기획/개발 시점_년도' },
      { id: 'plan-m', type: 'input', content: '월', exportLabel: '기획/개발 시점_월' },
    ],
  },
  {
    id: 'r3',
    label: '출시_서비스_시점',
    cells: [
      { id: 'found-c', type: 'text', content: '(3) 설립연도', isHidden: true },
      { id: 'found-y-c', type: 'input', content: '년', isHidden: true },
      { id: 'found-m-c', type: 'input', content: '월', isHidden: true },
      { id: 'ai-c', type: 'text', content: '(4) 인공지능 시작연도', isHidden: true },
      { id: 'launch', type: 'text', content: '(4-2) 출시/서비스 시점' },
      { id: 'launch-y', type: 'input', content: '년', mobileLabel: '출시 연도' },
      { id: 'launch-m', type: 'input', content: '월' },
    ],
  },
];

function Harness({ errorCellIds }: { errorCellIds?: Set<string> }) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        mobileTableDisplayMode="item-cards"
        value={value}
        onChange={setValue}
        errorCellIds={errorCellIds}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe('항목 단위 카드 — 모바일', () => {
  it('라벨마다 카드가 서고, 병합된 상위 라벨은 아래 행 카드 제목에 따라간다', () => {
    render(<Harness />);
    const headers = screen.getAllByTestId('item-card-header').map((el) => el.textContent);
    expect(headers).toEqual([
      '(3) 설립연도',
      '(4) 인공지능 시작연도(4-1) 기획/개발 시점',
      '(4) 인공지능 시작연도(4-2) 출시/서비스 시점',
    ]);
    expect(within(screen.getByTestId('item-card-found-y')).getAllByRole('textbox')).toHaveLength(2);
    expect(within(screen.getByTestId('item-card-launch-y')).getAllByRole('textbox')).toHaveLength(2);
  });

  it('입력 칸 위에 엑셀 라벨은 내보내지 않고, 셀에 적은 모바일 라벨만 보인다', () => {
    render(<Harness />);
    expect(screen.queryByText('설립연도_년')).not.toBeInTheDocument();
    expect(screen.queryByText('기획/개발 시점_월')).not.toBeInTheDocument();
    expect(screen.getByText('출시 연도')).toBeInTheDocument();
  });

  it('입력한 값이 셀 id 로 쓰인다', () => {
    render(<Harness />);
    const [year] = within(screen.getByTestId('item-card-plan-y')).getAllByRole('textbox');
    fireEvent.change(year!, { target: { value: '2020' } });
    fireEvent.blur(year!);
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '{}')).toEqual({
      'plan-y': '2020',
    });
  });

  it('검증 위반 칸은 그 카드 안에서 표식되고 위치 이동 타깃이 된다', () => {
    const { container } = render(<Harness errorCellIds={new Set(['launch-m'])} />);
    const target = container.querySelector('[data-cell-id="launch-m"]');
    expect(target).not.toBeNull();
    expect(screen.getByTestId('item-card-launch-y')).toContainElement(target as HTMLElement);
    expect(target?.querySelector('.ring-red-300')).not.toBeNull();
  });
});
