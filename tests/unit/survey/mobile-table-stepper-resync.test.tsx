import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 상세 입력 카드는 contact-attrs context 등 깊은 의존을 가지므로 stub 한다.
// 검증 대상은 displayRows 변경 시 stepper 의 phase/사전선택 재동기화뿐이다.
vi.mock('@/components/survey-builder/mobile-row-card', () => ({
  MobileRowCard: ({ row }: { row: { id: string } }) => (
    <div data-testid={`row-card-${row.id}`} />
  ),
}));

import { MobileTableStepper } from '@/components/survey-builder/mobile-table-stepper';
import type { QuestionConditionGroup, TableColumn, TableRow } from '@/types/survey';

const visibleColumns: TableColumn[] = [
  { id: 'c0', label: '항목' },
  { id: 'c1', label: '값' },
];

// rowspan 없는 단순 행 → detectRowGroups 가 하나의 그룹으로 합침 → skipGroupSelect=true
// (row-select phase 로 분류됨). SMALL_TABLE_THRESHOLD(15) 초과를 위해 18행 생성.
function makeRows(opts?: { withConditionOnFirst?: boolean }): TableRow[] {
  const dummyCondition = {
    logic: 'and',
    conditions: [],
  } as unknown as QuestionConditionGroup;

  return Array.from({ length: 18 }, (_, i) => {
    const row: TableRow = {
      id: `r${i}`,
      label: `행 ${i}`,
      cells: [
        { id: `r${i}c0`, type: 'text', content: `행 ${i}` },
        { id: `r${i}c1`, type: 'input', content: '' },
      ],
    };
    if (opts?.withConditionOnFirst && i === 0) {
      row.displayCondition = dummyCondition;
    }
    return row;
  });
}

const baseProps = {
  questionId: 'q1',
  visibleColumns,
  visibleHeaderGrid: null,
  currentResponse: {},
  hideColumnLabels: false,
  isTestMode: false,
  value: {},
  onChange: () => {},
  hasDynamicRows: false,
  selectedRowIds: [],
  groupConfigMap: new Map<string, unknown>(),
  onSelectGroup: () => {},
};

describe('MobileTableStepper displayRows 변경 시 phase 재동기화', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('displayCondition 이 생겨 분류가 detail 로 바뀌면 사전선택 phase 가 stale 로 남지 않는다', () => {
    // 최초: displayCondition 없음 → needsPreSelect=true → row-select phase
    const { rerender, queryByText } = render(
      <MobileTableStepper {...baseProps} displayRows={makeRows()} />,
    );

    // row-select phase 의 안내 문구가 보여야 한다
    expect(queryByText('세부 항목을 선택하세요')).not.toBeNull();

    // 선행 질문 응답으로 한 행에 displayCondition 이 생김 → hasRowFiltering=true
    // → needsPreSelect=false → 분류가 detail 로 뒤집힌다.
    // key 없이 리렌더되므로 phase 가 재동기화되지 않으면 row-select 안내가 그대로 남는다(버그).
    rerender(
      <MobileTableStepper
        {...baseProps}
        displayRows={makeRows({ withConditionOnFirst: true })}
      />,
    );

    // 재동기화가 동작하면 사전선택 안내가 사라지고 평범한 스테퍼(detail)가 렌더된다.
    expect(queryByText('세부 항목을 선택하세요')).toBeNull();
    // 평범한 스테퍼는 '완료' 카운트 텍스트와 '다음' 버튼을 가진다.
    expect(queryByText('다음')).not.toBeNull();
  });

  it('같은 분류 안에서 displayRows reference 만 흔들리면 phase 가 리셋되지 않는다', () => {
    // 두 렌더 모두 displayCondition 없음 → 둘 다 row-select 분류
    const { rerender, queryByText } = render(
      <MobileTableStepper {...baseProps} displayRows={makeRows()} />,
    );
    expect(queryByText('세부 항목을 선택하세요')).not.toBeNull();

    // 새 배열 reference(같은 분류) 전달 → row-select 가 유지되어야 한다
    rerender(<MobileTableStepper {...baseProps} displayRows={makeRows()} />);
    expect(queryByText('세부 항목을 선택하세요')).not.toBeNull();
  });
});
