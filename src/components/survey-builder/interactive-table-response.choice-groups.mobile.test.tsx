import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 보기 그룹 표 — 모바일 표시 모드 넷(자동 카드 · 선택 행 원본 · 행별 원본 · 원본 표)에서
 * 보기 셀이 컨트롤로 보이고, 선택이 표 응답 안 `__choiceGroups` 에 쓰이며, 행 완료·진행률이
 * 그룹 단위로 센다. 행 단위 카드(row-cards)는 이 스펙 범위 밖이다.
 */

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/lib/survey/contact-attrs-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/survey/contact-attrs-context')>()),
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
  { id: 'c1', label: '구분', width: 120 },
  { id: 'c2', label: '보기 1', width: 120 },
  { id: 'c3', label: '보기 2', width: 120 },
  { id: 'c4', label: '수량', width: 120 },
];

const choiceGroups: ChoiceGroup[] = [
  { id: 'g1', groupKey: 'rad1', type: 'radio', label: '보유' },
  { id: 'g2', groupKey: 'cb1', type: 'checkbox', label: '구매처' },
];

const rows: TableRow[] = [
  {
    id: 'r1',
    label: '보유',
    cells: [
      { id: 'r1-lbl', content: '보유', type: 'text' },
      { id: 'uhd', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1' },
      { id: 'fhd', content: 'FHD', type: 'choice_opt', choiceGroupId: 'g1' },
      { id: 'amount', content: '', type: 'input', placeholder: '수량' },
    ],
  },
  {
    id: 'r2',
    label: '구매처',
    cells: [
      { id: 'r2-lbl', content: '구매처', type: 'text' },
      { id: 'online', content: '온라인', type: 'choice_opt', choiceGroupId: 'g2' },
      { id: 'store', content: '대리점', type: 'choice_opt', choiceGroupId: 'g2' },
      { id: 'r2-blank', content: '', type: 'text' },
    ],
  },
];

function Harness({
  mode,
  initial = {},
}: {
  mode: 'auto' | 'drilldown-original-row' | 'row-wise-original' | 'original';
  initial?: Record<string, unknown>;
}) {
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        choiceGroups={choiceGroups}
        mobileTableDisplayMode={mode}
        mobileDrilldownOmitLeadingColumns={1}
        value={value}
        onChange={setValue}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

function readValue(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('value').textContent ?? '{}');
}

describe('보기 그룹 표 — 모바일 표시 모드', () => {
  it('자동 카드(스테퍼)에서 보기 셀이 라디오·체크박스로 보이고 선택이 예약 키에 쓰인다', () => {
    render(<Harness mode="auto" />);
    fireEvent.click(screen.getByRole('radio', { name: 'FHD' }));
    expect(readValue()).toEqual({ __choiceGroups: { rad1: 'fhd' } });
  });

  it('선택 행 원본 보기에서 행을 열면 보기 셀이 컨트롤로 보이고, 고르면 그 행이 완료로 센다', () => {
    render(<Harness mode="drilldown-original-row" />);
    expect(screen.getByText(/전체/)).toHaveTextContent('전체 0 / 2개 항목');
    fireEvent.click(screen.getByRole('button', { name: /구매처/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: '대리점' }));
    expect(readValue()).toEqual({ __choiceGroups: { cb1: ['store'] } });
    expect(screen.getByText(/전체/)).toHaveTextContent('전체 1 / 2개 항목');
  });

  it('행별 원본 문항 보기에서 보기 셀만 있는 행도 문항이 되고 선택이 쓰인다', () => {
    render(<Harness mode="row-wise-original" />);
    expect(screen.getByRole('group', { name: '구매처' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'UHD' }));
    expect(readValue()).toEqual({ __choiceGroups: { rad1: 'uhd' } });
  });

  it('원본 표에서도 보기 셀이 컨트롤로 보인다', () => {
    render(<Harness mode="original" initial={{ __choiceGroups: { rad1: 'fhd' } }} />);
    expect(screen.getByRole('radio', { name: 'FHD' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '온라인' }));
    expect(readValue()).toEqual({ __choiceGroups: { rad1: 'fhd', cb1: ['online'] } });
  });
});
