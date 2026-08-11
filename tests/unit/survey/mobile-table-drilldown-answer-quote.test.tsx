/**
 * 최종 리뷰 I1 — 모바일 표 드릴다운 내비게이션 라벨의 응답 인용 치환.
 *
 * mobile-table-drilldown.tsx 에는 substituteTokens 호출이 하나도 없어서, 같은 화면에서
 * 상세 패널은 치환된 문구를 보여주는데 목차·크럼브·열 라벨에는 {{{인용}}} 원문이 그대로
 * 노출됐다. 형제 컴포넌트인 choice-table-drilldown.tsx 는 이미 배선돼 있다.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MobileTableDrilldown } from '@/components/survey-builder/mobile-table-drilldown';
import { ContactAttrsProvider } from '@/lib/survey/contact-attrs-context';
import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';

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
  { id: 'c0', label: '항목', width: 140 },
  { id: 'c1', label: '{{{인용}}} 1점', width: 140 },
  { id: 'c2', label: '{{{인용}}} 2점', width: 140 },
];

// 2단 헤더여야 buildColGroups 가 상위 그룹 라벨을 만든다(matrix 상세의 파란 그룹 헤더).
const headerGrid: HeaderCell[][] = [
  [
    { id: 'h0', label: '항목', colspan: 1, rowspan: 2 },
    { id: 'h1', label: '{{{인용}}} 그룹', colspan: 2, rowspan: 1 },
  ],
  [
    { id: 'h2', label: '{{{인용}}} 1점', colspan: 1, rowspan: 1 },
    { id: 'h3', label: '{{{인용}}} 2점', colspan: 1, rowspan: 1 },
  ],
];

// 행마다 값 열이 2개 → matrix 섹션. 첫 열 라벨 셀은 rowspan 2 로 두 행을 한 섹션으로 묶는다.
const rows: TableRow[] = [
  {
    id: 'r1',
    label: '{{{인용}}} 행1',
    cells: [
      { id: 'r1c0', type: 'text', content: '{{{인용}}} 섹션', rowspan: 2 },
      {
        id: 'r1c1',
        type: 'radio',
        content: '',
        radioOptions: [{ id: 'o1', label: '1', value: '1' }],
      },
      {
        id: 'r1c2',
        type: 'radio',
        content: '',
        radioOptions: [{ id: 'o2', label: '2', value: '2' }],
      },
    ],
  },
  {
    id: 'r2',
    label: '{{{인용}}} 행2',
    cells: [
      { id: 'r2c0', type: 'text', content: '{{{인용}}} 섹션', _isContinuation: true },
      {
        id: 'r2c1',
        type: 'radio',
        content: '',
        radioOptions: [{ id: 'o1', label: '1', value: '1' }],
      },
      {
        id: 'r2c2',
        type: 'radio',
        content: '',
        radioOptions: [{ id: 'o2', label: '2', value: '2' }],
      },
    ],
  },
] as unknown as TableRow[];

function renderDrilldown() {
  return render(
    <ContactAttrsProvider attrs={{}} quotes={{ 인용: '홍길동' }}>
      <MobileTableDrilldown
        questionId="q1"
        authoredRows={rows}
        displayRows={rows}
        authoredColumns={columns}
        visibleColumns={columns}
        visibleHeaderGrid={headerGrid}
        currentResponse={{}}
        hideColumnLabels={false}
        isTestMode
        hasDynamicRows={false}
        selectedRowIds={[]}
        groupConfigMap={new Map()}
        detailMode="legacy"
        omitLeadingAuthoredColumns={0}
      />
    </ContactAttrsProvider>,
  );
}

describe('모바일 표 드릴다운 — 응답 인용 치환', () => {
  it('목차의 섹션 제목을 치환한다', () => {
    renderDrilldown();

    expect(screen.getByText('홍길동 섹션')).toBeInTheDocument();
    expect(screen.queryByText('{{{인용}}} 섹션')).not.toBeInTheDocument();
  });

  it('섹션 안 리프 목록의 행 제목을 치환한다', () => {
    renderDrilldown();
    fireEvent.click(screen.getByText('홍길동 섹션'));

    expect(screen.getByText('홍길동 행1')).toBeInTheDocument();
    expect(screen.getByText('홍길동 행2')).toBeInTheDocument();
    expect(screen.queryByText('{{{인용}}} 행1')).not.toBeInTheDocument();
  });

  it('matrix 리프 상세의 열 그룹 제목과 열 라벨을 치환한다', () => {
    renderDrilldown();
    fireEvent.click(screen.getByText('홍길동 섹션'));
    fireEvent.click(screen.getByText('홍길동 행1'));

    expect(screen.getByText('홍길동 그룹')).toBeInTheDocument();
    expect(screen.getByText('홍길동 1점')).toBeInTheDocument();
    expect(screen.getByText('홍길동 2점')).toBeInTheDocument();
    expect(screen.queryByText('{{{인용}}} 그룹')).not.toBeInTheDocument();
    expect(screen.queryByText('{{{인용}}} 1점')).not.toBeInTheDocument();
  });
});
