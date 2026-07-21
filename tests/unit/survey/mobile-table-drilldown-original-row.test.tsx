import { useState } from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { InteractiveTableResponse } from '@/components/survey-builder/interactive-table-response';
import { MobileDrilldownShell } from '@/components/survey-builder/mobile-drilldown-shell';
import type { Question, TableCell, TableColumn, TableRow } from '@/types/survey';
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

function ControlledOmittedRadioScale({
  onValue,
}: {
  onValue: (value: Record<string, unknown>) => void;
}) {
  const [value, setValue] = useState<Record<string, unknown>>({
    'omitted-score': '0',
    'retained-score-1': '',
    'retained-score-2': '',
  });
  const columns: TableColumn[] = [
    { id: 'label', label: '항목' },
    { id: 'omitted', label: '0점' },
    { id: 'retained-1', label: '1점' },
    { id: 'retained-2', label: '2점' },
  ];
  const rows: TableRow[] = [{
    id: 'omitted-radio-row',
    label: '원본 라디오 행',
    cells: [
      { id: 'omitted-label', type: 'text', content: '원본 라디오 행' },
      {
        id: 'omitted-score',
        type: 'radio',
        content: '',
        radioGroupName: 'score',
        radioOptions: [{ id: 'zero', label: '0점', value: '0' }],
      },
      {
        id: 'retained-score-1',
        type: 'radio',
        content: '',
        radioGroupName: 'score',
        radioOptions: [{ id: 'one', label: '1점', value: '1' }],
      },
      {
        id: 'retained-score-2',
        type: 'radio',
        content: '',
        radioGroupName: 'score',
        radioOptions: [{ id: 'two', label: '2점', value: '2' }],
      },
    ],
  }];

  return (
    <InteractiveTableResponse
      questionId="omitted-radio-question"
      columns={columns}
      rows={rows}
      mobileTableDisplayMode="drilldown-original-row"
      mobileDrilldownOmitLeadingColumns={2}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

function ControlledRowspanRadioScale({
  onValue,
}: {
  onValue: (value: Record<string, unknown>) => void;
}) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  const columns: TableColumn[] = [
    { id: 'rowspan-radio-section', label: '섹션' },
    { id: 'rowspan-radio-a-column', label: 'A' },
    { id: 'rowspan-radio-b-column', label: 'B' },
    { id: 'rowspan-radio-extra-column', label: '추가 입력' },
  ];
  const rows: TableRow[] = [
    {
      id: 'rowspan-radio-source-row',
      label: '첫 항목',
      cells: [
        { id: 'rowspan-radio-first-section', type: 'text', content: '첫 섹션' },
        {
          id: 'rowspan-radio-a',
          type: 'radio',
          content: '',
          rowspan: 2,
          radioGroupName: 'rowspan-shared-group',
          radioOptions: [{ id: 'a', label: 'A 선택', value: 'a' }],
        },
        {
          id: 'rowspan-radio-b',
          type: 'radio',
          content: '',
          radioGroupName: 'rowspan-shared-group',
          radioOptions: [{ id: 'b', label: 'B 선택', value: 'b' }],
        },
        { id: 'rowspan-radio-first-description', type: 'text', content: '첫 행 설명' },
      ],
    },
    {
      id: 'rowspan-radio-continuation-row',
      label: '둘째 항목',
      cells: [
        { id: 'rowspan-radio-second-section', type: 'text', content: '둘째 섹션' },
        {
          id: 'rowspan-radio-a-continuation',
          type: 'radio',
          content: '',
          isHidden: true,
          _isContinuation: true,
        },
        { id: 'rowspan-radio-second-description', type: 'text', content: '둘째 행 설명' },
        {
          id: 'rowspan-radio-second-input',
          type: 'input',
          content: '',
          placeholder: '둘째 행 입력',
        },
      ],
    },
  ];

  return (
    <InteractiveTableResponse
      questionId="rowspan-radio-question"
      columns={columns}
      rows={rows}
      mobileTableDisplayMode="drilldown-original-row"
      mobileDrilldownOmitLeadingColumns={1}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

function ControlledRankingScale() {
  const [value, setValue] = useState<Record<string, unknown>>({});
  const rankingCell: TableCell = {
    id: 'ranking-cell',
    type: 'ranking',
    content: '',
    rankingConfig: { positions: 1 },
    rankingOptions: [
      { id: 'ranking-a', label: '선택 A', value: 'a' },
      { id: 'ranking-b', label: '선택 B', value: 'b' },
    ],
  };

  return (
    <InteractiveTableResponse
      questionId="ranking-table-question"
      columns={[
        { id: 'ranking-label-column', label: '항목' },
        { id: 'ranking-value-column', label: '순위' },
      ]}
      rows={[{
        id: 'ranking-row',
        label: '순위 행',
        cells: [
          { id: 'ranking-label', type: 'text', content: '순위 행' },
          rankingCell,
        ],
      }]}
      mobileTableDisplayMode="drilldown-original-row"
      mobileDrilldownOmitLeadingColumns={1}
      value={value}
      onChange={setValue}
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

const conditionalSectionColumns = (): TableColumn[] => [
  { id: 'conditional-section', label: '섹션', width: 140 },
  { id: 'conditional-item', label: '항목', width: 140 },
  { id: 'conditional-score-1', label: '1점', width: 140 },
  { id: 'conditional-score-5', label: '5점', width: 140 },
];

const visibilitySourceQuestion = {
  id: 'visibility-source',
  type: 'radio',
  title: '섹션 표시',
  required: false,
  order: 0,
  options: [
    { id: 'show', label: '표시', value: 'show' },
    { id: 'hide', label: '숨김', value: 'hide' },
  ],
} as Question;

const conditionalSectionRows = (): TableRow[] => [
  {
    id: 'conditional-first-row',
    label: '첫 항목',
    displayCondition: {
      logicType: 'AND',
      conditions: [{
        id: 'show-first-section',
        sourceQuestionId: visibilitySourceQuestion.id,
        conditionType: 'value-match',
        logicType: 'AND',
        requiredValues: ['show'],
      }],
    },
    cells: [
      { id: 'conditional-first-section-label', type: 'text', content: '첫 섹션' },
      { id: 'conditional-first-item-label', type: 'text', content: '첫 항목' },
      {
        id: 'conditional-first-score-1',
        type: 'radio',
        content: '',
        radioGroupName: 'conditional-first-score',
        radioOptions: [{ id: 'one', label: '1점', value: '1' }],
      },
      {
        id: 'conditional-first-score-5',
        type: 'radio',
        content: '',
        radioGroupName: 'conditional-first-score',
        radioOptions: [{ id: 'five', label: '5점', value: '5' }],
      },
    ],
  },
  {
    id: 'conditional-second-row',
    label: '둘째 항목',
    cells: [
      { id: 'conditional-second-section-label', type: 'text', content: '둘째 섹션' },
      { id: 'conditional-second-item-label', type: 'text', content: '둘째 항목' },
      {
        id: 'conditional-second-score-1',
        type: 'radio',
        content: '',
        radioGroupName: 'conditional-second-score',
        radioOptions: [{ id: 'one', label: '1점', value: '1' }],
      },
      {
        id: 'conditional-second-score-5',
        type: 'radio',
        content: '',
        radioGroupName: 'conditional-second-score',
        radioOptions: [{ id: 'five', label: '5점', value: '5' }],
      },
    ],
  },
];

function ConditionalSectionScale({ showFirstSection }: { showFirstSection: boolean }) {
  return (
    <InteractiveTableResponse
      questionId="conditional-section-question"
      columns={conditionalSectionColumns()}
      rows={conditionalSectionRows()}
      allQuestions={[visibilitySourceQuestion]}
      allResponses={{
        [visibilitySourceQuestion.id]: showFirstSection ? 'show' : 'hide',
      }}
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

it('displayCondition으로 현재 section이 사라져 자동 root 복귀하면 다음 section 상세 scroll을 0으로 초기화한다', async () => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  const { rerender } = render(<ConditionalSectionScale showFirstSection />);
  fireEvent.click(screen.getByRole('button', { name: /첫 섹션/ }));

  const firstBodyScroller = screen.getByTestId('table-preview-scroll');
  firstBodyScroller.scrollLeft = 80;
  fireEvent.scroll(firstBodyScroller);

  rerender(<ConditionalSectionScale showFirstSection={false} />);
  expect(screen.getByText('작성할 항목을 선택하세요')).toBeInTheDocument();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  fireEvent.click(screen.getByRole('button', { name: /둘째 섹션/ }));
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

it('제외된 radio에 기존 응답이 있어도 retained 멤버 선택 시 같은 그룹 전체를 비운다', () => {
  const onValue = vi.fn<(value: Record<string, unknown>) => void>();
  render(<ControlledOmittedRadioScale onValue={onValue} />);
  fireEvent.click(screen.getByRole('button', { name: /원본 라디오 행/ }));

  expect(screen.queryByRole('radio', { name: '0점' })).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: '2점' }));

  expect(onValue).toHaveBeenLastCalledWith({
    'omitted-score': '',
    'retained-score-1': '',
    'retained-score-2': '2',
  });
});

it('continuation 상세에 materialize된 rowspan radio는 source 행 sibling 응답을 비운다', () => {
  const onValue = vi.fn<(value: Record<string, unknown>) => void>();
  render(<ControlledRowspanRadioScale onValue={onValue} />);

  fireEvent.click(screen.getByRole('button', { name: /첫 섹션/ }));
  fireEvent.click(screen.getByRole('radio', { name: 'B 선택' }));
  expect(onValue).toHaveBeenLastCalledWith({
    'rowspan-radio-a': '',
    'rowspan-radio-b': 'b',
  });

  fireEvent.click(screen.getByRole('button', { name: '목차로' }));
  fireEvent.click(screen.getByRole('button', { name: /둘째 섹션/ }));
  fireEvent.click(screen.getByRole('radio', { name: 'A 선택' }));

  expect(onValue).toHaveBeenLastCalledWith({
    'rowspan-radio-a': 'a',
    'rowspan-radio-b': '',
  });
});

it('ranking의 마지막 순위를 지우면 행 진행률이 다시 미완료가 된다', () => {
  render(<ControlledRankingScale />);
  fireEvent.click(screen.getByRole('button', { name: /순위 행/ }));
  const ranking = screen.getByRole('combobox');

  expect(screen.getByText(/전체/)).toHaveTextContent('전체 0 / 1개 항목');
  fireEvent.change(ranking, { target: { value: 'a' } });
  expect(screen.getByText(/전체/)).toHaveTextContent('전체 1 / 1개 항목');
  fireEvent.change(ranking, { target: { value: '' } });
  expect(screen.getByText(/전체/)).toHaveTextContent('전체 0 / 1개 항목');
});

it('정적 행은 전체 진행률 분모와 완료 수에서 제외한다', () => {
  render(
    <InteractiveTableResponse
      questionId="static-progress-question"
      columns={[
        { id: 'static-label-column', label: '항목' },
        { id: 'static-value-column', label: '응답' },
      ]}
      rows={[
        {
          id: 'static-row',
          label: '설명',
          cells: [
            { id: 'static-label', type: 'text', content: '설명' },
            { id: 'static-description', type: 'text', content: '응답 안내' },
          ],
        },
        {
          id: 'answer-row-1',
          label: '첫 응답',
          cells: [
            { id: 'answer-label-1', type: 'text', content: '첫 응답' },
            { id: 'answer-input-1', type: 'input', content: '' },
          ],
        },
        {
          id: 'answer-row-2',
          label: '둘째 응답',
          cells: [
            { id: 'answer-label-2', type: 'text', content: '둘째 응답' },
            { id: 'answer-input-2', type: 'input', content: '' },
          ],
        },
      ]}
      mobileTableDisplayMode="drilldown-original-row"
      mobileDrilldownOmitLeadingColumns={1}
      value={{}}
      onChange={vi.fn()}
    />,
  );

  expect(screen.getByText(/전체/)).toHaveTextContent('전체 0 / 2개 항목');
});

it.each(['text', 'image', 'video'] as const)(
  'table의 hidden %s rowspan 하위 라벨은 anchor와 continuation 탐색에 새지 않고 입력은 남긴다',
  (hiddenType) => {
    const hiddenLabel = `숨긴 ${hiddenType} 하위 라벨`;
    render(
      <InteractiveTableResponse
        questionId={`hidden-${hiddenType}-table`}
        columns={[
          { id: 'hidden-section-column', label: '섹션' },
          { id: 'hidden-subgroup-column', label: '하위 그룹' },
          { id: 'hidden-item-column', label: '항목' },
          { id: 'hidden-input-column', label: '응답' },
        ]}
        rows={[
          {
            id: 'hidden-row-1',
            label: hiddenLabel,
            cells: [
              { id: 'visible-section', type: 'text', content: '공개 섹션', rowspan: 2 },
              {
                id: 'hidden-subgroup',
                type: hiddenType,
                content: hiddenLabel,
                rowspan: 2,
                mobileDisplay: 'hidden',
              },
              { id: 'visible-item-1', type: 'text', content: '첫 공개 항목' },
              {
                id: 'visible-input-1',
                type: 'input',
                content: '숨긴 인터랙티브 라벨',
                placeholder: '첫 응답 가능',
                mobileDisplay: 'hidden',
              },
            ],
          },
          {
            id: 'hidden-row-2',
            label: hiddenLabel,
            cells: [
              {
                id: 'visible-section-continuation',
                type: 'text',
                content: '',
                isHidden: true,
                _isContinuation: true,
              },
              {
                id: 'hidden-subgroup-continuation',
                type: hiddenType,
                content: '',
                isHidden: true,
                _isContinuation: true,
              },
              { id: 'visible-item-2', type: 'text', content: '둘째 공개 항목' },
              {
                id: 'visible-input-2',
                type: 'input',
                content: '숨긴 인터랙티브 라벨',
                placeholder: '둘째 응답 가능',
                mobileDisplay: 'hidden',
              },
            ],
          },
        ]}
        mobileTableDisplayMode="drilldown-original-row"
        mobileDrilldownOmitLeadingColumns={3}
        value={{}}
        onChange={vi.fn()}
      />,
    );

    const expectHiddenLabelsAbsent = () => {
      expect(document.body.textContent).not.toContain(hiddenLabel);
      expect(document.body.textContent).not.toContain('숨긴 인터랙티브 라벨');
    };

    expectHiddenLabelsAbsent();
    fireEvent.click(screen.getByRole('button', { name: /공개 섹션/ }));
    expectHiddenLabelsAbsent();
    fireEvent.click(screen.getByRole('button', { name: /첫 공개 항목/ }));
    expectHiddenLabelsAbsent();
    expect(screen.getByPlaceholderText('첫 응답 가능')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    fireEvent.click(screen.getByRole('button', { name: /둘째 공개 항목/ }));
    expectHiddenLabelsAbsent();
    expect(screen.getByPlaceholderText('둘째 응답 가능')).toBeInTheDocument();
  },
);

it.each(['text', 'image', 'video'] as const)(
  'displayCondition으로 hidden %s rowspan anchor 행이 제거되어도 승격 continuation에 라벨이 새지 않는다',
  (hiddenType) => {
    const hiddenLabel = `조건부 숨김 ${hiddenType} anchor`;
    render(
      <InteractiveTableResponse
        questionId={`conditional-hidden-${hiddenType}`}
        columns={[
          { id: `conditional-hidden-${hiddenType}-section`, label: '섹션' },
          { id: `conditional-hidden-${hiddenType}-item`, label: '항목' },
          { id: `conditional-hidden-${hiddenType}-value`, label: '응답' },
        ]}
        rows={[
          {
            id: `conditional-hidden-${hiddenType}-anchor-row`,
            label: '숨겨질 anchor 행',
            displayCondition: {
              logicType: 'AND',
              conditions: [{
                id: `conditional-hidden-${hiddenType}-condition`,
                sourceQuestionId: visibilitySourceQuestion.id,
                conditionType: 'value-match',
                logicType: 'AND',
                requiredValues: ['show'],
              }],
            },
            cells: [
              {
                id: `conditional-hidden-${hiddenType}-anchor`,
                type: hiddenType,
                content: hiddenLabel,
                rowspan: 2,
                mobileDisplay: 'hidden',
              },
              {
                id: `conditional-hidden-${hiddenType}-anchor-item`,
                type: 'text',
                content: '숨겨질 항목',
              },
              {
                id: `conditional-hidden-${hiddenType}-anchor-input`,
                type: 'input',
                content: '',
              },
            ],
          },
          {
            id: `conditional-hidden-${hiddenType}-continuation-row`,
            label: '공개 항목',
            cells: [
              {
                id: `conditional-hidden-${hiddenType}-continuation`,
                type: hiddenType,
                content: '',
                isHidden: true,
                _isContinuation: true,
              },
              {
                id: `conditional-hidden-${hiddenType}-public-item`,
                type: 'text',
                content: '공개 항목',
              },
              {
                id: `conditional-hidden-${hiddenType}-public-input`,
                type: 'input',
                content: '',
                placeholder: `${hiddenType} 공개 입력`,
              },
            ],
          },
        ]}
        allQuestions={[visibilitySourceQuestion]}
        allResponses={{ [visibilitySourceQuestion.id]: 'hide' }}
        mobileTableDisplayMode="drilldown-original-row"
        mobileDrilldownOmitLeadingColumns={2}
        value={{}}
        onChange={vi.fn()}
      />,
    );

    expect(document.body.textContent).not.toContain(hiddenLabel);
    fireEvent.click(screen.getByRole('button', { name: /^항목/ }));
    expect(document.body.textContent).not.toContain(hiddenLabel);
    expect(screen.getByPlaceholderText(`${hiddenType} 공개 입력`)).toBeInTheDocument();
  },
);

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

function RerenderableShell({
  sections,
  onReturnToRoot,
}: {
  sections: ClassifiedSection[];
  onReturnToRoot?: () => void;
}) {
  return (
    <MobileDrilldownShell
      sections={sections}
      leafNavigation="always"
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
      renderLeafDetail={(item) => <div data-testid="rerender-leaf-detail">{item.label}</div>}
      {...(onReturnToRoot ? { onReturnToRoot } : {})}
    />
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

it('현재 leaf 앞에 항목이 삽입되거나 재정렬되어도 row identity로 같은 상세를 유지한다', () => {
  const initial = [section([leaf('r1', '첫 항목'), leaf('r2', '둘째 항목')])];
  const { rerender } = render(<RerenderableShell sections={initial} />);
  enterFirstLeaf();
  fireEvent.click(screen.getByRole('button', { name: '다음 항목' }));
  expect(screen.getByTestId('rerender-leaf-detail')).toHaveTextContent('둘째 항목');

  rerender(
    <RerenderableShell
      sections={[
        section([
          leaf('inserted', '삽입 항목'),
          leaf('r1', '첫 항목'),
          leaf('r2', '둘째 항목'),
        ]),
      ]}
    />,
  );

  expect(screen.getByTestId('rerender-leaf-detail')).toHaveTextContent('둘째 항목');
});

it('현재 section 앞에 section이 삽입되어도 안정 section identity로 같은 상세를 유지한다', () => {
  const first = section([leaf('section-a-leaf', 'A 항목')], { label: 'A 섹션' });
  const current = section([leaf('section-b-leaf', 'B 항목')], { label: 'B 섹션' });
  const { rerender } = render(<RerenderableShell sections={[first, current]} />);
  fireEvent.click(screen.getByRole('button', { name: /B 섹션/ }));
  expect(screen.getByTestId('rerender-leaf-detail')).toHaveTextContent('B 항목');

  rerender(
    <RerenderableShell
      sections={[
        section([leaf('inserted-section-leaf', '삽입 항목')], { label: '삽입 섹션' }),
        first,
        current,
      ]}
    />,
  );

  expect(screen.getByTestId('rerender-leaf-detail')).toHaveTextContent('B 항목');
});

it('현재 leaf가 제거되면 저장된 nav도 정리하고 해당 section의 안전한 목록으로 돌아간다', async () => {
  const original = section([leaf('r1', '첫 항목'), leaf('r2', '둘째 항목')]);
  const { rerender } = render(
    <RerenderableShell sections={[original]} />,
  );
  enterFirstLeaf();
  fireEvent.click(screen.getByRole('button', { name: '다음 항목' }));

  rerender(
    <RerenderableShell
      sections={[section([leaf('r1', '첫 항목')], { label: '척도' })]}
    />,
  );

  expect(screen.queryByTestId('rerender-leaf-detail')).toBeNull();
  expect(screen.getByRole('button', { name: /첫 항목/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '뒤로' })).toBeInTheDocument();

  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  rerender(<RerenderableShell sections={[original]} />);
  expect(screen.queryByTestId('rerender-leaf-detail')).toBeNull();
  expect(screen.getByRole('button', { name: /둘째 항목/ })).toBeInTheDocument();
});

it('현재 section이 제거되면 저장된 nav도 정리하고 빈 화면 없이 안전한 root로 돌아간다', async () => {
  const remaining = section([leaf('section-a-leaf', 'A 항목')], { label: 'A 섹션' });
  const removed = section([leaf('section-b-leaf', 'B 항목')], { label: 'B 섹션' });
  const onReturnToRoot = vi.fn();
  const { rerender } = render(
    <RerenderableShell sections={[remaining, removed]} onReturnToRoot={onReturnToRoot} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /B 섹션/ }));

  rerender(<RerenderableShell sections={[remaining]} onReturnToRoot={onReturnToRoot} />);

  expect(screen.queryByTestId('rerender-leaf-detail')).toBeNull();
  expect(screen.getByText('작성할 항목을 선택하세요')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /A 섹션/ })).toBeInTheDocument();

  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(onReturnToRoot).toHaveBeenCalledTimes(1);
  rerender(
    <RerenderableShell sections={[remaining, removed]} onReturnToRoot={onReturnToRoot} />,
  );
  expect(screen.queryByTestId('rerender-leaf-detail')).toBeNull();
  expect(screen.getByText('작성할 항목을 선택하세요')).toBeInTheDocument();
  expect(onReturnToRoot).toHaveBeenCalledTimes(1);
});

it('breadcrumb 뒤로 버튼은 44px 최소 터치 타깃을 가진다', () => {
  renderShell({ sections: twoLeafMatrix(), leafNavigation: 'always' });
  enterFirstLeaf();

  expect(screen.getByRole('button', { name: '뒤로' })).toHaveClass('min-h-11');
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
