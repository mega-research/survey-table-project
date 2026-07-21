import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { InteractiveTableResponse } from '@/components/survey-builder/interactive-table-response';
import { MobileDrilldownShell } from '@/components/survey-builder/mobile-drilldown-shell';
import type { TableColumn, TableRow } from '@/types/survey';
import type { ClassifiedLeaf, ClassifiedSection } from '@/utils/classify-table';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/lib/survey/contact-attrs-context', () => ({
  useContactAttrs: () => ({}),
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

afterEach(() => {
  vi.restoreAllMocks();
});

const scaleColumns = (): TableColumn[] => [
  { id: 'c0', label: '항목', width: 140 },
  { id: 'c1', label: '전혀 도움 안 됨', width: 140 },
  { id: 'c2', label: '매우 도움 됨', width: 140 },
];

const scaleRows = (count: number): TableRow[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `r${index + 1}`,
    label: index === 0 ? '직무 설정' : '취업 도움',
    cells: [
      {
        id: `r${index + 1}-label`,
        type: 'text',
        content: index === 0 ? '직무 설정' : '취업 도움',
      },
      {
        id: `r${index + 1}-score-1`,
        type: 'radio',
        content: '',
        radioGroupName: `scale-${index + 1}`,
        radioOptions: [{ id: 'one', label: '1점', value: '1' }],
      },
      {
        id: `r${index + 1}-score-5`,
        type: 'radio',
        content: '',
        radioGroupName: `scale-${index + 1}`,
        radioOptions: [{ id: 'five', label: '5점', value: '5' }],
      },
    ],
  }));

const groupedScaleColumns = (): TableColumn[] => [
  { id: 'group', label: '그룹', width: 140 },
  { id: 'item', label: '항목', width: 140 },
  { id: 'score-1', label: '전혀 도움 안 됨', width: 140 },
  { id: 'score-5', label: '매우 도움 됨', width: 140 },
];

const groupedScaleRows = (): TableRow[] => [
  {
    id: 'grouped-r1',
    label: '직무 설정',
    cells: [
      { id: 'group-label', type: 'text', content: '척도', rowspan: 2 },
      { id: 'grouped-r1-label', type: 'text', content: '직무 설정' },
      {
        id: 'grouped-r1-score-1',
        type: 'radio',
        content: '',
        radioGroupName: 'grouped-scale-1',
        radioOptions: [{ id: 'one', label: '1점', value: '1' }],
      },
      {
        id: 'grouped-r1-score-5',
        type: 'radio',
        content: '',
        radioGroupName: 'grouped-scale-1',
        radioOptions: [{ id: 'five', label: '5점', value: '5' }],
      },
    ],
  },
  {
    id: 'grouped-r2',
    label: '취업 도움',
    cells: [
      {
        id: 'group-label-continuation',
        type: 'text',
        content: '',
        isHidden: true,
        _isContinuation: true,
      },
      { id: 'grouped-r2-label', type: 'text', content: '취업 도움' },
      {
        id: 'grouped-r2-score-1',
        type: 'radio',
        content: '',
        radioGroupName: 'grouped-scale-2',
        radioOptions: [{ id: 'one', label: '1점', value: '1' }],
      },
      {
        id: 'grouped-r2-score-5',
        type: 'radio',
        content: '',
        radioGroupName: 'grouped-scale-2',
        radioOptions: [{ id: 'five', label: '5점', value: '5' }],
      },
    ],
  },
];

function ControlledScale({
  onValue,
}: {
  onValue?: (value: Record<string, unknown>) => void;
} = {}) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <InteractiveTableResponse
      questionId="q1"
      columns={scaleColumns()}
      rows={scaleRows(2)}
      mobileTableDisplayMode="drilldown-original-row"
      mobileDrilldownOmitLeadingColumns={1}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

function GroupedScale() {
  return (
    <InteractiveTableResponse
      questionId="grouped-question"
      columns={groupedScaleColumns()}
      rows={groupedScaleRows()}
      mobileTableDisplayMode="drilldown-original-row"
      mobileDrilldownOmitLeadingColumns={2}
      value={{}}
      onChange={vi.fn()}
    />
  );
}

function getOriginalRowHeaderScroller(): HTMLElement {
  const scroller = screen.getAllByRole('columnheader')[0]?.parentElement?.parentElement;
  if (!(scroller instanceof HTMLElement)) throw new Error('헤더 스크롤 컨테이너가 없습니다.');
  return scroller;
}

it('임계값 이하 2행도 명시 모드면 카드부터 보여주고 선택 행 원본 헤더를 렌더한다', () => {
  render(
    <InteractiveTableResponse
      questionId="q1"
      columns={scaleColumns()}
      rows={scaleRows(2)}
      mobileTableDisplayMode="drilldown-original-row"
      mobileDrilldownOmitLeadingColumns={1}
      value={{}}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByText('직무 설정')).toBeInTheDocument();
  expect(screen.queryByText('전혀 도움 안 됨')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /직무 설정/ }));
  expect(screen.getByText('전혀 도움 안 됨')).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: '항목' })).toBeNull();
});

it('방문만으로 완료되지 않고 radio 선택 후 완료 행 수가 1 증가한다', () => {
  render(<ControlledScale />);
  fireEvent.click(screen.getByRole('button', { name: /직무 설정/ }));
  expect(screen.getByText(/전체/)).toHaveTextContent('전체 0 / 2개 항목');
  fireEvent.click(screen.getByRole('radio', { name: '5점' }));
  expect(screen.getByText(/전체/)).toHaveTextContent('전체 1 / 2개 항목');
});

it('상세 unmount 후 다음 leaf에 가로 위치를 복원하고 목차 복귀 후 0으로 초기화한다', () => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  render(<GroupedScale />);
  fireEvent.click(screen.getByRole('button', { name: /척도/ }));
  fireEvent.click(screen.getByRole('button', { name: /직무 설정/ }));

  const firstBodyScroller = screen.getByTestId('table-preview-scroll');
  const firstHeaderScroller = getOriginalRowHeaderScroller();
  firstBodyScroller.scrollLeft = 80;
  fireEvent.scroll(firstBodyScroller);
  expect(firstHeaderScroller.scrollLeft).toBe(80);

  fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
  expect(screen.queryByTestId('table-preview-scroll')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /취업 도움/ }));
  const secondBodyScroller = screen.getByTestId('table-preview-scroll');
  const secondHeaderScroller = getOriginalRowHeaderScroller();
  expect(secondBodyScroller).not.toBe(firstBodyScroller);
  expect(secondBodyScroller.scrollLeft).toBe(80);
  expect(secondHeaderScroller.scrollLeft).toBe(80);

  fireEvent.click(screen.getByRole('button', { name: '목차로' }));
  fireEvent.click(screen.getByRole('button', { name: /척도/ }));
  fireEvent.click(screen.getByRole('button', { name: /직무 설정/ }));
  expect(screen.getByTestId('table-preview-scroll').scrollLeft).toBe(0);
  expect(getOriginalRowHeaderScroller().scrollLeft).toBe(0);
});

it('제외된 열 뒤에 interactive cell이 없으면 기존 카드 상세로 fallback한다', () => {
  const columns: TableColumn[] = [
    { id: 'c0', label: '선택', width: 140 },
    { id: 'c1', label: '섹션', width: 140 },
    { id: 'c2', label: '설명', width: 140 },
  ];
  const rows: TableRow[] = [
    {
      id: 'fallback-row',
      label: '행 A',
      cells: [
        {
          id: 'fallback-radio',
          type: 'radio',
          content: '',
          radioOptions: [{ id: 'yes', label: '선택하기', value: 'yes' }],
        },
        { id: 'fallback-section', type: 'text', content: '기본 섹션' },
        { id: 'fallback-label', type: 'text', content: '행 A' },
      ],
    },
  ];

  render(
    <InteractiveTableResponse
      questionId="fallback-question"
      columns={columns}
      rows={rows}
      mobileTableDisplayMode="drilldown-original-row"
      mobileDrilldownOmitLeadingColumns={1}
      value={{}}
      onChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /기본 섹션/ }));
  expect(screen.getByRole('radio', { name: '선택하기' })).toBeInTheDocument();
  expect(screen.queryByRole('grid')).toBeNull();
});

it('통합 원본 행 radio가 같은 행 sibling을 비우고 cell id 응답 shape를 유지한다', () => {
  const onValue = vi.fn<(value: Record<string, unknown>) => void>();
  render(<ControlledScale onValue={onValue} />);
  fireEvent.click(screen.getByRole('button', { name: /직무 설정/ }));

  const first = screen.getByRole('radio', { name: '1점' });
  fireEvent.click(first);
  expect(first).toBeChecked();
  expect(onValue).toHaveBeenLastCalledWith({
    'r1-score-5': '',
    'r1-score-1': '1',
  });

  fireEvent.click(screen.getByRole('radio', { name: '5점' }));
  expect(onValue).toHaveBeenLastCalledWith({
    'r1-score-5': '5',
    'r1-score-1': '',
  });
  expect(screen.getByRole('radio', { name: '1점' })).not.toBeChecked();
});

const leaf = (rowId: string, label: string): ClassifiedLeaf => ({
  rowId,
  label,
  subGroup: '',
  inputCellIds: [`${rowId}-value`],
  cellByCol: { 1: `${rowId}-value` },
});

const section = (
  leaves: ClassifiedLeaf[],
  overrides: Partial<ClassifiedSection> = {},
): ClassifiedSection => ({
  label: leaves.length === 1 ? '항목' : '척도',
  kind: 'matrix',
  reason: '테스트',
  leaves,
  colGroups: [{ label: '점수', cols: [{ col: 1, label: '1점' }] }],
  totalInputs: leaves.length,
  ...overrides,
});

const singleLeafSections = () => [section([leaf('r1', '첫 항목')])];
const twoLeafMatrix = () => [section([leaf('r1', '첫 항목'), leaf('r2', '둘째 항목')])];

function renderShell({
  sections = twoLeafMatrix(),
  leafNavigation = 'always',
  onReturnToRoot = vi.fn(),
  onLeaveLeafForward = vi.fn(),
  onLeaveSection = vi.fn(),
  renderLegacySection,
}: {
  sections?: ClassifiedSection[];
  leafNavigation?: 'matrix-only' | 'always';
  onReturnToRoot?: () => void;
  onLeaveLeafForward?: (item: ClassifiedLeaf) => void;
  onLeaveSection?: (item: ClassifiedSection) => void;
  renderLegacySection?: (item: ClassifiedSection) => React.ReactNode;
} = {}) {
  return render(
    <MobileDrilldownShell
      sections={sections}
      leafNavigation={leafNavigation}
      overallStatus={{
        completed: 0,
        total: sections.flatMap((item) => item.leaves).length,
        unit: '개 항목',
      }}
      getSectionStatus={(item) => ({
        completed: 0,
        total: item.leaves.length,
        unit: '개 항목',
      })}
      getLeafStatus={() => ({ completed: 0, total: 1, unit: '개 항목' })}
      renderLeafDetail={(item) => (
        <div data-testid="leaf-detail">
          <span>{item.label}</span>
          <input type="radio" aria-label="1점" />
        </div>
      )}
      {...(renderLegacySection ? { renderLegacySection } : {})}
      onLeaveLeafForward={onLeaveLeafForward}
      onLeaveSection={onLeaveSection}
      onReturnToRoot={onReturnToRoot}
    />,
  );
}

function enterFirstLeaf() {
  fireEvent.click(screen.getByRole('button', { name: /척도/ }));
  fireEvent.click(screen.getByRole('button', { name: /첫 항목/ }));
}

it('always 모드는 단일 leaf도 루트 카드 클릭 후 상세를 연다', () => {
  renderShell({ sections: singleLeafSections(), leafNavigation: 'always' });
  expect(screen.getByRole('button', { name: /항목/ })).toBeInTheDocument();
  expect(screen.queryByTestId('leaf-detail')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /항목/ }));
  expect(screen.getByTestId('leaf-detail')).toBeInTheDocument();
});

it('always 모드는 여러 leaf에서 목록을 거쳐 선택한 상세를 연다', () => {
  renderShell({ sections: twoLeafMatrix(), leafNavigation: 'always' });
  fireEvent.click(screen.getByRole('button', { name: /척도/ }));
  expect(screen.queryByTestId('leaf-detail')).toBeNull();
  expect(screen.getByRole('button', { name: /첫 항목/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /둘째 항목/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /첫 항목/ }));
  expect(screen.getByTestId('leaf-detail')).toHaveTextContent('첫 항목');
});

function ControlledShell() {
  const sections = twoLeafMatrix();
  const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set());
  const completed = selectedRows.size;

  return (
    <MobileDrilldownShell
      sections={sections}
      leafNavigation="always"
      overallStatus={{ completed, total: 2, unit: '개 항목' }}
      getSectionStatus={(item) => ({
        completed: item.leaves.filter((candidate) => selectedRows.has(candidate.rowId)).length,
        total: item.leaves.length,
        unit: '개 항목',
      })}
      getLeafStatus={(item) => ({
        completed: selectedRows.has(item.rowId) ? 1 : 0,
        total: 1,
        unit: '개 항목',
      })}
      renderLeafDetail={(item) => (
        <div data-testid="leaf-detail">
          <span>{item.label}</span>
          <input
            type="radio"
            aria-label={`${item.label} 선택`}
            checked={selectedRows.has(item.rowId)}
            onChange={() =>
              setSelectedRows((previous) => {
                const next = new Set(previous);
                next.add(item.rowId);
                return next;
              })
            }
          />
        </div>
      )}
    />
  );
}

it('응답과 상태가 제어 rerender되어도 명시적 다음 버튼 전에는 현재 leaf를 유지한다', () => {
  render(<ControlledShell />);
  enterFirstLeaf();
  fireEvent.click(screen.getByRole('radio', { name: '첫 항목 선택' }));
  expect(screen.getByRole('radio', { name: '첫 항목 선택' })).toBeChecked();
  expect(screen.getByTestId('leaf-detail')).toHaveTextContent('첫 항목');
  expect(screen.getByText(/전체/)).toHaveTextContent('전체 1 / 2개 항목');
  fireEvent.click(screen.getByRole('button', { name: '다음 항목' }));
  expect(screen.getByTestId('leaf-detail')).toHaveTextContent('둘째 항목');
});

it('always 모드는 빈 leaf section에서도 목록 탐색과 다음 section 이동을 유지한다', () => {
  const sections = [
    section([], { label: '빈 항목' }),
    section([leaf('r2', '다음 항목')], { label: '다음 섹션' }),
  ];
  renderShell({ sections, leafNavigation: 'always' });
  fireEvent.click(screen.getByRole('button', { name: /빈 항목/ }));
  expect(screen.getByRole('button', { name: '뒤로' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '목차로' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '다음 섹션' })).toBeInTheDocument();
  expect(screen.queryByTestId('leaf-detail')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '다음 섹션' }));
  expect(screen.getByTestId('leaf-detail')).toHaveTextContent('다음 항목');
});

it('matrix-only 모드는 빈 matrix section에서도 목차 복귀 탐색을 유지한다', () => {
  renderShell({
    sections: [section([], { label: '빈 매트릭스' })],
    leafNavigation: 'matrix-only',
  });
  fireEvent.click(screen.getByRole('button', { name: /빈 매트릭스/ }));
  expect(screen.getByRole('button', { name: '뒤로' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '목차로' })).toBeInTheDocument();
  expect(screen.queryByTestId('leaf-detail')).toBeNull();
});

it('matrix-only 모드는 scalar/list를 legacy inline으로, matrix를 leaf 목록으로 렌더한다', () => {
  const sections = [
    section([leaf('scalar', '스칼라 값')], { label: '스칼라', kind: 'scalar' }),
    section([leaf('list-1', '목록 값 1'), leaf('list-2', '목록 값 2')], {
      label: '리스트',
      kind: 'list',
    }),
    section([leaf('matrix-1', '매트릭스 값 1'), leaf('matrix-2', '매트릭스 값 2')], {
      label: '매트릭스',
    }),
  ];
  renderShell({
    sections,
    leafNavigation: 'matrix-only',
    renderLegacySection: (item) => <div data-testid="legacy-section">{item.kind}</div>,
  });

  fireEvent.click(screen.getByRole('button', { name: /스칼라/ }));
  expect(screen.getByTestId('legacy-section')).toHaveTextContent('scalar');
  fireEvent.click(screen.getByRole('button', { name: '뒤로' }));

  fireEvent.click(screen.getByRole('button', { name: /리스트/ }));
  expect(screen.getByTestId('legacy-section')).toHaveTextContent('list');
  fireEvent.click(screen.getByRole('button', { name: '뒤로' }));

  fireEvent.click(screen.getByRole('button', { name: /매트릭스/ }));
  expect(screen.queryByTestId('legacy-section')).toBeNull();
  expect(screen.queryByTestId('leaf-detail')).toBeNull();
  expect(screen.getByRole('button', { name: /매트릭스 값 1/ })).toBeInTheDocument();
});

it('leaf 전진, section 전진, root 복귀 callback을 순서대로 한 번씩 호출한다', () => {
  const events: string[] = [];
  const onLeaveLeafForward = vi.fn((item: ClassifiedLeaf) => events.push(`leaf:${item.rowId}`));
  const onLeaveSection = vi.fn((item: ClassifiedSection) => events.push(`section:${item.label}`));
  const onReturnToRoot = vi.fn();

  renderShell({
    sections: [
      section([leaf('r1', '첫 항목'), leaf('r2', '둘째 항목')], { label: '첫 섹션' }),
      section([leaf('r3', '셋째 항목')], { label: '둘째 섹션' }),
    ],
    onLeaveLeafForward,
    onLeaveSection,
    onReturnToRoot: () => {
      events.push('root');
      onReturnToRoot();
    },
  });

  fireEvent.click(screen.getByRole('button', { name: /첫 섹션/ }));
  fireEvent.click(screen.getByRole('button', { name: /첫 항목/ }));
  fireEvent.click(screen.getByRole('button', { name: '다음 항목' }));
  fireEvent.click(screen.getByRole('button', { name: '다음 섹션' }));
  fireEvent.click(screen.getByRole('button', { name: '목차로' }));

  expect(onLeaveLeafForward).toHaveBeenCalledTimes(1);
  expect(onLeaveSection).toHaveBeenCalledTimes(2);
  expect(onReturnToRoot).toHaveBeenCalledTimes(1);
  expect(events).toEqual(['leaf:r1', 'section:첫 섹션', 'section:둘째 섹션', 'root']);
});
