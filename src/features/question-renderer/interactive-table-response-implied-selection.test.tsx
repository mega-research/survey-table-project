import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  ChoiceGroup,
  Question,
  QuestionConditionGroup,
  TableCell,
  TableColumn,
  TableRow,
} from '@/types/survey';

import { InteractiveTableResponse } from './interactive-table-response';

/**
 * 따라 선택 응답 화면 (CONTEXT.md "따라 선택") — 여성기업 사전 설문조사 C7.
 * 열마다 체크박스 그룹(알고 있음 · 지원 경험 · 수혜 경험), 수혜 → 지원 → 알고 로 같은 행에 짝이 걸려 있다.
 * ⑦ 「모두 수혜 경험 없음」은 수혜 그룹의 단독 선택 보기다.
 */

const view = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => view.mobile,
  useMediaQuery: () => view.mobile,
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
afterEach(() => {
  view.mobile = false;
});

const columns: TableColumn[] = [
  { id: 'item', label: '항목', width: 200 },
  { id: 'know', label: '알고 있음', width: 120 },
  { id: 'apply', label: '지원 경험 있음', width: 120 },
  { id: 'benefit', label: '수혜 경험 있음', width: 120 },
];
const groups: ChoiceGroup[] = [
  { id: 'g-know', groupKey: 'chk01', type: 'checkbox', label: '알고 있음' },
  { id: 'g-apply', groupKey: 'chk02', type: 'checkbox', label: '지원 경험 있음' },
  { id: 'g-benefit', groupKey: 'chk03', type: 'checkbox', label: '수혜 경험 있음' },
];

const opt = (id: string, label: string, groupId: string, extra: Partial<TableCell> = {}) =>
  ({
    id,
    type: 'choice_opt',
    content: '',
    choiceLabel: label,
    choiceGroupId: groupId,
    ...extra,
  }) as TableCell;

function itemRow(n: number, title: string, linked: boolean, extra: Partial<TableRow> = {}) {
  return {
    id: `r${n}`,
    label: title,
    cells: [
      { id: `item${n}`, type: 'text', content: title },
      opt(`know${n}`, `알고 ${n}`, 'g-know'),
      opt(`apply${n}`, `지원 ${n}`, 'g-apply', linked ? { impliedCellIds: [`know${n}`] } : {}),
      opt(`benefit${n}`, `수혜 ${n}`, 'g-benefit', linked ? { impliedCellIds: [`apply${n}`] } : {}),
    ],
    ...extra,
  } as TableRow;
}
const noneRow: TableRow = {
  id: 'r7',
  label: '모두 수혜 경험 없음',
  cells: [
    { id: 'item7', type: 'text', content: '⑦ 모두 수혜 경험 없음' },
    opt('benefit-none', '수혜 없음', 'g-benefit', { exclusiveChoice: true, colspan: 3 }),
    { id: 'pad1', type: 'text', content: '', isHidden: true },
    { id: 'pad2', type: 'text', content: '', isHidden: true },
  ],
};
const linkedRows = (linked = true): TableRow[] => [
  itemRow(1, '① 금융/자금 지원', linked),
  itemRow(2, '② 인력 지원', linked),
  noneRow,
];

function Harness({
  rows = linkedRows(),
  initialValue = {},
  mobileMode,
  allResponses,
  allQuestions,
}: {
  rows?: TableRow[];
  initialValue?: Record<string, unknown>;
  mobileMode?: 'row-group-cards';
  allResponses?: Record<string, unknown>;
  allQuestions?: Question[];
}) {
  const [value, setValue] = useState<Record<string, unknown>>(initialValue);
  return (
    <>
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        choiceGroups={groups}
        mobileTableDisplayMode={mobileMode}
        value={value}
        onChange={setValue}
        allResponses={allResponses}
        allQuestions={allQuestions}
        enableSticky={false}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const groupsOf = () => JSON.parse(screen.getByTestId('value').textContent!).__choiceGroups ?? {};
const box = (name: string) => screen.getByRole('checkbox', { name });

describe('따라 선택 — 고를 때', () => {
  it('수혜를 체크하면 같은 행의 지원·알고 있음이 함께 체크된다', () => {
    render(<Harness />);
    fireEvent.click(box('수혜 1'));
    expect(groupsOf()).toEqual({ chk03: ['benefit1'], chk02: ['apply1'], chk01: ['know1'] });
    expect(box('지원 1')).toBeChecked();
    expect(box('알고 1')).toBeChecked();
    expect(box('알고 2')).not.toBeChecked();
  });

  it('지원을 체크하면 알고 있음만 함께 체크된다', () => {
    render(<Harness />);
    fireEvent.click(box('지원 2'));
    expect(groupsOf()).toEqual({ chk02: ['apply2'], chk01: ['know2'] });
  });

  it('알고 있음은 짝이 없어 그것만 체크된다', () => {
    render(<Harness />);
    fireEvent.click(box('알고 1'));
    expect(groupsOf()).toEqual({ chk01: ['know1'] });
  });

  it('짝을 걸지 않은 표는 누른 칸만 체크된다', () => {
    render(<Harness rows={linkedRows(false)} />);
    fireEvent.click(box('수혜 1'));
    expect(groupsOf()).toEqual({ chk03: ['benefit1'] });
  });
});

describe('따라 선택 — 풀 때는 누른 칸 하나만', () => {
  const allChecked = {
    __choiceGroups: { chk03: ['benefit1'], chk02: ['apply1'], chk01: ['know1'] },
  };

  it('따라 체크된 알고 있음을 풀면 수혜·지원은 그대로다', () => {
    render(<Harness initialValue={allChecked} />);
    fireEvent.click(box('알고 1'));
    expect(groupsOf()).toEqual({ chk03: ['benefit1'], chk02: ['apply1'], chk01: [] });
  });

  it('수혜를 풀어도 지원·알고 있음은 그대로다', () => {
    render(<Harness initialValue={allChecked} />);
    fireEvent.click(box('수혜 1'));
    expect(groupsOf()).toEqual({ chk03: [], chk02: ['apply1'], chk01: ['know1'] });
  });
});

describe('따라 선택 — 단독 선택 보기', () => {
  it('「모두 수혜 경험 없음」을 고르면 수혜 열만 비고 따라 체크됐던 칸은 남는다', () => {
    render(<Harness />);
    fireEvent.click(box('수혜 1'));
    fireEvent.click(box('수혜 없음'));
    expect(groupsOf()).toEqual({ chk03: ['benefit-none'], chk02: ['apply1'], chk01: ['know1'] });
  });

  it('「모두 수혜 경험 없음」이 골라진 채 수혜를 체크하면 그것이 풀리고 따라 선택도 된다', () => {
    render(<Harness initialValue={{ __choiceGroups: { chk03: ['benefit-none'] } }} />);
    fireEvent.click(box('수혜 2'));
    expect(groupsOf()).toEqual({ chk03: ['benefit2'], chk02: ['apply2'], chk01: ['know2'] });
  });
});

describe('따라 선택 — 저장된 응답', () => {
  it('열기만 해서는 체크가 늘지 않는다', () => {
    render(<Harness initialValue={{ __choiceGroups: { chk03: ['benefit1'] } }} />);
    expect(box('수혜 1')).toBeChecked();
    expect(box('지원 1')).not.toBeChecked();
    expect(box('알고 1')).not.toBeChecked();
    expect(groupsOf()).toEqual({ chk03: ['benefit1'] });
  });
});

describe('따라 선택 — 모바일 행 단위 그룹 카드', () => {
  it('타일을 눌러도 같은 행의 다른 그룹이 함께 체크된다', () => {
    view.mobile = true;
    render(<Harness mobileMode="row-group-cards" />);
    fireEvent.click(box('수혜 1'));
    expect(groupsOf()).toEqual({ chk03: ['benefit1'], chk02: ['apply1'], chk01: ['know1'] });
  });
});

describe('따라 선택 — 조건으로 숨은 행', () => {
  const showWhenYes: QuestionConditionGroup = {
    logicType: 'AND',
    conditions: [
      {
        id: 'c',
        sourceQuestionId: 'src',
        conditionType: 'value-match',
        requiredValues: ['y'],
        logicType: 'AND',
      },
    ],
  };
  const source = {
    id: 'src',
    type: 'radio',
    title: '원천',
    required: false,
    order: 0,
    options: [
      { id: 's1', label: '예', value: 'y' },
      { id: 's2', label: '아니오', value: 'n' },
    ],
  } as Question;
  // 첫 행의 수혜가 둘째 행의 알고 있음을 가리키고, 둘째 행은 조건부다
  const crossRows: TableRow[] = [
    {
      ...itemRow(1, '① 금융/자금 지원', false),
      cells: itemRow(1, '① 금융/자금 지원', false).cells.map((cell) =>
        cell.id === 'benefit1' ? { ...cell, impliedCellIds: ['know2'] } : cell,
      ),
    },
    itemRow(2, '② 인력 지원', false, { displayCondition: showWhenYes }),
  ];

  it('보이는 행의 칸은 다른 행이어도 따라 체크된다', () => {
    render(<Harness rows={crossRows} allResponses={{ src: 'y' }} allQuestions={[source]} />);
    fireEvent.click(box('수혜 1'));
    expect(groupsOf()).toEqual({ chk03: ['benefit1'], chk01: ['know2'] });
  });

  it('숨은 행의 칸은 따라 체크되지 않는다', () => {
    render(<Harness rows={crossRows} allResponses={{ src: 'n' }} allQuestions={[source]} />);
    expect(screen.queryByRole('checkbox', { name: '알고 2' })).not.toBeInTheDocument();
    fireEvent.click(box('수혜 1'));
    expect(groupsOf()).toEqual({ chk03: ['benefit1'] });
  });
});
