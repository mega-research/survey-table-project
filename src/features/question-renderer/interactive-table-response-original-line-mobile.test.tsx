import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup, HeaderCell, TableColumn, TableRow } from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 보기 그룹 표 — 「행 단위 그룹 카드」에서 그룹 옵션(mobileOriginalLine)을 켠 그룹만 세로 타일
 * 대신 원본 한 줄(잘라 낸 헤더 + 보기 셀)로 그린다. 해운물류 멘토 C4(활용 여부 + 11점 만족도).
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

const CIRC = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const columns: TableColumn[] = [
  { id: 'category', label: '구분', width: 60 },
  { id: 'item', label: '평가항목', width: 190 },
  { id: 'use1', label: '활용함', width: 70 },
  { id: 'use2', label: '활용 안함', width: 64 },
  ...CIRC.map((_, n) => ({ id: `s${n}`, label: `${n}점`, width: 64 })),
];
const head = (id: string, label: string, colspan: number, rowspan = 1): HeaderCell => ({
  id,
  label,
  colspan,
  rowspan,
});
const headerGrid: HeaderCell[][] = [
  [head('h-cat', '구분', 1, 2), head('h-item', '평가항목', 1, 2), head('h-use', '활용 여부', 2), head('h-sat', '만족도', 11)],
  [
    head('h-u1', '활용함', 1),
    head('h-u2', '활용 안함', 1),
    head('h-0', '매우 불만족', 1),
    head('h-neg', '불만족', 4),
    head('h-5', '보통', 1),
    head('h-pos', '만족', 4),
    head('h-10', '매우 만족', 1),
  ],
];
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '회의실 및 교통비 지원',
    cells: [
      { id: 'cat', type: 'text', content: '지원 제도' },
      { id: 'item', type: 'text', content: '1) 회의실 및 교통비 지원' },
      { id: 'use1', type: 'choice_opt', content: '①', choiceLabel: '활용함', choiceGroupId: 'g-use' },
      { id: 'use2', type: 'choice_opt', content: '②', choiceLabel: '활용 안함', choiceGroupId: 'g-use' },
      ...CIRC.map((content, n) => ({
        id: `sat${n}`,
        type: 'choice_opt' as const,
        content,
        choiceLabel: `${n}점`,
        choiceGroupId: 'g-sat',
      })),
    ],
  },
];

function Harness({ originalLine }: { originalLine: boolean }) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  const groups: ChoiceGroup[] = [
    { id: 'g-use', groupKey: 'rad1', type: 'radio', label: '활용 여부' },
    { id: 'g-sat', groupKey: 'rad2', type: 'radio', label: '만족도', mobileOriginalLine: originalLine },
  ];
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        tableHeaderGrid={headerGrid}
        choiceGroups={groups}
        mobileTableDisplayMode="row-group-cards"
        value={value}
        onChange={setValue}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe('행 단위 그룹 카드 — 원본 한 줄 그룹 옵션', () => {
  it('켠 그룹만 잘라 낸 헤더 + 보기 한 줄로 그리고, 다른 그룹은 세로 타일 그대로다', () => {
    render(<Harness originalLine />);
    const line = screen.getByTestId('choice-group-original-line-g-sat');
    for (const label of ['만족도', '매우 불만족', '불만족', '보통', '만족', '매우 만족']) {
      expect(within(line).getByText(label)).toBeInTheDocument();
    }
    // 그룹 밖 열(활용 여부)의 헤더는 한 줄에 없다
    expect(within(line).queryByText('활용 여부')).not.toBeInTheDocument();
    expect(within(line).getAllByRole('radio')).toHaveLength(11);
    expect(within(line).getByText('⑤')).toBeInTheDocument();
    // 활용 여부는 종전 타일
    expect(screen.queryByTestId('choice-group-original-line-g-use')).not.toBeInTheDocument();
    expect(screen.getByText('활용 안함', { selector: 'span' })).toBeInTheDocument();
  });

  it('한 줄의 칸을 누르면 그 그룹 선택으로 저장된다', () => {
    render(<Harness originalLine />);
    fireEvent.click(within(screen.getByTestId('choice-group-original-line-g-sat')).getByText('⑦'));
    expect(JSON.parse(screen.getByTestId('value').textContent!)).toEqual({
      __choiceGroups: { rad2: 'sat7' },
    });
  });

  it('옵션을 끄면 종전처럼 11장 세로 타일이다', () => {
    render(<Harness originalLine={false} />);
    expect(screen.queryByTestId('choice-group-original-line-g-sat')).not.toBeInTheDocument();
    expect(screen.getByText('10점')).toBeInTheDocument();
  });
});
