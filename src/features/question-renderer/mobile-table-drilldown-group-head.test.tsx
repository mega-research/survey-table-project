/**
 * 모바일 표 드릴다운 — 묶음 머리 · 설명 셀 · 계산 전용 요약 · 이전/다음 섹션 이동.
 *
 * 표 모양은 「직업 분류 | 설명 | 입력 2칸 | 합계(계산)」. 「3. 개발자」는 계산 셀만 있는 소계 행이고
 * 그 아래 하위 행들은 왼쪽의 세로 병합된 빈 칸(숨기기)으로 들여써져 있다.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
import { MobileTableDrilldown } from '@/features/question-renderer/mobile-table-drilldown';
import type { TableCell, TableColumn, TableRow } from '@/types/survey';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
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
  { id: 'c0', label: '직업 분류', width: 30 },
  { id: 'c1', label: '직업 분류', width: 140 },
  { id: 'c2', label: '설명', width: 200 },
  { id: 'c3', label: '상용', width: 80 },
  { id: 'c4', label: '임시', width: 80 },
  { id: 'c5', label: '합계', width: 80 },
];

const text = (id: string, content: string, o: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'text',
  content,
  ...o,
});
const hidden = (id: string): TableCell => ({ id, type: 'text', content: '', isHidden: true });
const input = (id: string): TableCell => ({ id, type: 'input', inputType: 'number', content: '' });
const calc = (id: string): TableCell => ({
  id,
  type: 'calc',
  content: '',
  formula: { kind: 'literal', value: 0 },
});

const topRow = (
  key: string,
  title: string,
  o: { calcOnly?: boolean; desc?: Partial<TableCell> } = {},
): TableRow => ({
  id: key,
  label: '',
  cells: [
    text(`${key}-title`, title, { colspan: 2 }),
    hidden(`${key}-h`),
    text(`${key}-desc`, `${title} 설명 첫 줄\n${title} 설명 둘째 줄`, o.desc),
    o.calcOnly ? calc(`${key}-a`) : input(`${key}-a`),
    o.calcOnly ? calc(`${key}-b`) : input(`${key}-b`),
    calc(`${key}-sum`),
  ],
});
const childRow = (key: string, title: string, first: TableCell): TableRow => ({
  id: key,
  label: '',
  cells: [
    first,
    text(`${key}-title`, title),
    text(`${key}-desc`, `${title} 설명 첫 줄\n${title} 설명 둘째 줄`, {
      mobileDisplay: 'collapsed',
    }),
    input(`${key}-a`),
    input(`${key}-b`),
    calc(`${key}-sum`),
  ],
});

const rows = (): TableRow[] => [
  topRow('r1', '1. 관리자', { desc: { mobileDisplay: 'collapsed' } }),
  topRow('r2', '2. {{{인용}}} 컨설턴트', {
    desc: { mobileDisplay: 'inline', content: '{{{인용}}} 설명 첫 줄\n바로표시 둘째 줄' },
  }),
  topRow('r3', '3. 개발자', { calcOnly: true, desc: { mobileDisplay: 'collapsed' } }),
  childRow('r31', '3-1. 설계', text('marker', '', { rowspan: 2, mobileDisplay: 'hidden' })),
  childRow('r32', '3-2. SW', hidden('r32-h0')),
  topRow('rt', '합계', { calcOnly: true, desc: { content: '' } }),
];

function renderDrilldown(
  o: {
    displayRows?: TableRow[];
    authoredRows?: TableRow[];
    detailMode?: 'legacy' | 'original-row';
    columns?: TableColumn[];
    navigateToCellRef?: React.MutableRefObject<((cellIds: readonly string[]) => void) | null>;
  } = {},
) {
  const authored = o.authoredRows ?? rows();
  return render(
    <ContactAttrsProvider attrs={{}} quotes={{ 인용: '홍길동' }}>
      <MobileTableDrilldown
        questionId="q1"
        authoredRows={authored}
        displayRows={o.displayRows ?? authored}
        authoredColumns={o.columns ?? columns}
        visibleColumns={o.columns ?? columns}
        currentResponse={{}}
        hideColumnLabels={false}
        hasDynamicRows={false}
        selectedRowIds={[]}
        groupConfigMap={new Map()}
        detailMode={o.detailMode ?? 'legacy'}
        navigateToCellRef={o.navigateToCellRef}
        omitLeadingAuthoredColumns={0}
        value={{}}
        onChange={vi.fn()}
      />
    </ContactAttrsProvider>,
  );
}

const card = (name: RegExp) => screen.getByRole('button', { name });

describe('모바일 표 드릴다운 — 목차의 묶음 머리와 계산 전용 요약', () => {
  it('하위 행은 각자 제목을 가진 카드가 되고 「항목」 카드는 생기지 않는다', () => {
    renderDrilldown();

    expect(card(/3-1\. 설계/)).toBeInTheDocument();
    expect(card(/3-2\. SW/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^항목/ })).not.toBeInTheDocument();
  });

  it('묶음 머리는 누르는 카드가 아니고 소계 값과 하위 카드를 품는다', () => {
    renderDrilldown();

    const group = screen.getByRole('group', { name: '3. 개발자' });
    expect(screen.queryByRole('button', { name: /^3\. 개발자/ })).not.toBeInTheDocument();
    expect(group.querySelector('[data-cell-id="r3-a"]')).not.toBeNull();
    expect(group.querySelector('[data-cell-id="r3-sum"]')).not.toBeNull();
    expect(within(group).getByRole('button', { name: /3-1\. 설계/ })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /3-2\. SW/ })).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: /1\. 관리자/ })).not.toBeInTheDocument();
  });

  it('소계 값에는 열 제목이 라벨로 붙는다', () => {
    renderDrilldown();

    const group = screen.getByRole('group', { name: '3. 개발자' });
    expect(within(group).getByText('상용')).toBeInTheDocument();
    expect(within(group).getByText('합계')).toBeInTheDocument();
  });

  it('머리의 설명은 「설명 보기」를 눌러야 펼쳐진다', () => {
    renderDrilldown();

    const group = screen.getByRole('group', { name: '3. 개발자' });
    expect(within(group).queryByText(/3\. 개발자 설명 둘째 줄/)).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: '설명 보기' }));
    expect(within(group).getByText(/3\. 개발자 설명 둘째 줄/)).toBeInTheDocument();
  });

  it('머리가 아닌 계산 전용 행(합계)은 값이 바로 보이는 요약이다', () => {
    renderDrilldown();

    expect(screen.queryByRole('button', { name: /^합계/ })).not.toBeInTheDocument();
    expect(document.querySelector('[data-cell-id="rt-sum"]')).not.toBeNull();
    expect(screen.queryByText(/표시 \d+개/)).not.toBeInTheDocument();
  });

  it('하위가 전부 숨겨지면 머리도 사라진다', () => {
    const all = rows();
    renderDrilldown({ displayRows: [all[0]!, all[1]!, all[2]!, all[5]!] });

    expect(screen.queryByText('3. 개발자')).not.toBeInTheDocument();
    expect(card(/1\. 관리자/)).toBeInTheDocument();
  });

  it('선택 행 원본 보기에서도 목차는 같은 묶음으로 나온다', () => {
    renderDrilldown({ detailMode: 'original-row' });

    const group = screen.getByRole('group', { name: '3. 개발자' });
    expect(within(group).getByRole('button', { name: /3-1\. 설계/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^합계/ })).not.toBeInTheDocument();
  });
});

describe('모바일 표 드릴다운 — 설명 셀', () => {
  it('「자세히」 설명은 카드에 첫 줄만 보인다', () => {
    renderDrilldown();

    const item = card(/1\. 관리자/);
    expect(within(item).getByText('1. 관리자 설명 첫 줄')).toBeInTheDocument();
    expect(within(item).queryByText(/1\. 관리자 설명 둘째 줄/)).not.toBeInTheDocument();
  });

  it('「바로표시」 설명은 카드에 전문이 보이고 토큰이 치환된다', () => {
    renderDrilldown();

    const item = card(/2\. 홍길동 컨설턴트/);
    expect(within(item).getByText(/홍길동 설명 첫 줄/)).toBeInTheDocument();
    expect(within(item).getByText(/바로표시 둘째 줄/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('{{{인용}}}');
  });

  it('상세 화면의 제목은 직업명이고 입력칸 위에 설명 전문이 보인다', () => {
    renderDrilldown();

    fireEvent.click(card(/3-1\. 설계/));

    expect(screen.getAllByText('3-1. 설계').length).toBeGreaterThan(0);
    expect(screen.getByText(/3-1\. 설계 설명 둘째 줄/)).toBeInTheDocument();
    expect(document.querySelector('[data-cell-id="r31-a"]')).not.toBeNull();
  });
});

describe('모바일 표 드릴다운 — 이전·다음 섹션 이동', () => {
  it('「다음 섹션」은 묶음 머리를 건너뛰어 첫 하위로 간다', () => {
    renderDrilldown();

    fireEvent.click(card(/2\. 홍길동 컨설턴트/));
    fireEvent.click(screen.getByRole('button', { name: /다음 섹션/ }));

    expect(document.querySelector('[data-cell-id="r31-a"]')).not.toBeNull();
  });

  it('「이전 섹션」은 묶음 머리를 건너뛰어 앞 직업으로 간다', () => {
    renderDrilldown();

    fireEvent.click(card(/3-1\. 설계/));
    fireEvent.click(screen.getByRole('button', { name: /이전 섹션/ }));

    expect(document.querySelector('[data-cell-id="r2-a"]')).not.toBeNull();
  });

  it('첫 섹션에는 「이전 섹션」이 없다', () => {
    renderDrilldown();

    fireEvent.click(card(/1\. 관리자/));

    expect(screen.queryByRole('button', { name: /이전 섹션/ })).not.toBeInTheDocument();
  });

  it('마지막 입력 섹션에서는 요약(합계)으로 넘어가지 않는다', () => {
    renderDrilldown();

    fireEvent.click(card(/3-2\. SW/));

    expect(screen.queryByRole('button', { name: /다음 섹션/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /이전 섹션/ })).toBeInTheDocument();
  });
});

describe('모바일 표 드릴다운 — 묶음 경계', () => {
  it('묶음 안의 계산 전용 하위 행은 묶음을 끊지 않고 그 안에 요약으로 남는다', () => {
    const all = rows();
    // 3-1 과 3-2 사이에 계산 전용 하위 행을 끼운다 (들여쓰기 병합 3행)
    const authored = [
      all[0]!,
      all[1]!,
      all[2]!,
      childRow('r31', '3-1. 설계', text('marker', '', { rowspan: 3, mobileDisplay: 'hidden' })),
      {
        id: 'r3x',
        label: '',
        cells: [
          hidden('r3x-h0'),
          text('r3x-title', '3-x. 중간 소계'),
          text('r3x-desc', ''),
          calc('r3x-a'),
          calc('r3x-b'),
          calc('r3x-sum'),
        ],
      },
      all[4]!,
      all[5]!,
    ];
    renderDrilldown({ authoredRows: authored });

    const group = screen.getByRole('group', { name: '3. 개발자' });
    expect(within(group).getByRole('button', { name: /3-1\. 설계/ })).toBeInTheDocument();
    expect(within(group).getByRole('group', { name: '3-x. 중간 소계' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /3-2\. SW/ })).toBeInTheDocument();
  });

  it('오류 배너의 위치 이동은 묶음 안 하위 직업의 상세로 간다', () => {
    const navigateToCellRef: React.MutableRefObject<((cellIds: readonly string[]) => void) | null> =
      {
        current: null,
      };
    renderDrilldown({ navigateToCellRef });

    act(() => navigateToCellRef.current?.(['r32-b']));

    expect(document.querySelector('[data-cell-id="r32-b"]')).not.toBeNull();
    expect(document.querySelector('[data-cell-id="r31-a"]')).toBeNull();
  });
});

describe('모바일 표 드릴다운 — 상세의 계산 칸 자리', () => {
  it('계산 칸은 맨 아래로 몰리지 않고 제 열 자리에 라벨과 함께 나온다', () => {
    // 「상용 | 합계(계산) | 임시」 — 계산 칸이 입력 칸 사이에 놓인 표
    const middleColumns: TableColumn[] = [
      ...columns.slice(0, 3),
      { id: 'c3', label: '상용', width: 80 },
      { id: 'c4', label: '소계', width: 80 },
      { id: 'c5', label: '임시', width: 80 },
    ];
    const row = (key: string, title: string): TableRow => ({
      id: key,
      label: '',
      cells: [
        text(`${key}-title`, title, { colspan: 2 }),
        hidden(`${key}-h`),
        text(`${key}-desc`, '', {}),
        input(`${key}-a`),
        { ...calc(`${key}-sum`), mobileLabel: '상용 소계' },
        input(`${key}-b`),
      ],
    });
    renderDrilldown({
      authoredRows: [row('r1', '1. 관리자'), row('r2', '2. 컨설턴트')],
      columns: middleColumns,
    });
    fireEvent.click(card(/1\. 관리자/));

    const labels = ['상용', '상용 소계', '임시'].map((label) => screen.getByText(label));
    expect(
      labels[0]!.compareDocumentPosition(labels[1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      labels[1]!.compareDocumentPosition(labels[2]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
