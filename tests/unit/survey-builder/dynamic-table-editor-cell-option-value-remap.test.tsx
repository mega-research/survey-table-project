import { useRef } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 셀 옵션 optionCode 편집으로 value 가 바뀌었을 때, 이 표 질문을 sourceQuestionId 로
 * 참조하는 "다른 질문"의 표시조건(table-cell-check 의 expectedValues — 셀 옵션 value 공간)이
 * 함께 리매핑되는지에 대한 회귀 테스트.
 *
 * 같은 표 안의 게이팅(enabledWhen)은 updateCell 이 셀 저장 커밋에서 처리하지만
 * (use-table-editor-update-cell-remap.test.tsx), 표 밖의 표시조건은 셀 저장이 아니라
 * 질문 저장 시점에 remapOptionValueInConditions 로 반영되어야 한다 — 질문 편집을
 * 취소하면 아무 일도 일어나지 않아야 하기 때문이다.
 *
 * 셀 편집 모달은 저장 버튼 하나로 대체한다(모달 내부 배선은 cell-content-modal 전용 테스트 담당).
 */
vi.mock('@/components/survey-builder/cell-content-modal', () => ({
  CellContentModal: ({
    cell,
    onSave,
  }: {
    cell: { id: string };
    onSave: (
      cell: unknown,
      valueChanges?: { oldValue: string; newValue: string }[],
    ) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSave(
          {
            ...cell,
            type: 'radio',
            radioOptions: [
              { id: 'a', label: '옵션 A', value: '1', optionCode: '1', isCustomOptionCode: true },
              { id: 'b', label: '옵션 B', value: '5', optionCode: '5', isCustomOptionCode: true },
            ],
          },
          [{ oldValue: 'option-2', newValue: '5' }],
        )
      }
    >
      셀 저장 시뮬레이션
    </button>
  ),
}));

import { DynamicTableEditor } from '@/components/survey-builder/dynamic-table-editor';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { Question, TableColumn, TableRow } from '@/types/survey';

const TABLE_QUESTION_ID = 'q-table';

const COLUMNS: TableColumn[] = [{ id: 'col-1', label: '열 1', width: 150 }];

function makeRows(): TableRow[] {
  return [
    {
      id: 'row-1',
      label: '행 1',
      cells: [
        {
          id: 'cell-1',
          content: '컨트롤 셀',
          type: 'radio',
          radioOptions: [
            { id: 'a', label: '옵션 A', value: '1', optionCode: '1', isCustomOptionCode: true },
            { id: 'b', label: '옵션 B', value: 'option-2' },
          ],
        },
      ],
    },
  ];
}

function seedSurvey() {
  const tableQuestion: Question = {
    id: TABLE_QUESTION_ID,
    type: 'table',
    title: '표 질문',
    required: false,
    order: 0,
    tableColumns: COLUMNS,
    tableRowsData: makeRows(),
  };
  const otherQuestion: Question = {
    id: 'q-other',
    type: 'radio',
    title: '참조 질문',
    required: false,
    order: 1,
    displayCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: 'cond-1',
          sourceQuestionId: TABLE_QUESTION_ID,
          conditionType: 'table-cell-check',
          tableConditions: {
            rowIds: ['row-1'],
            cellColumnIndex: 0,
            checkType: 'any',
            expectedValues: ['option-2'],
          },
          logicType: 'AND',
        },
      ],
    },
  };

  useSurveyBuilderStore.getState().setSurvey({
    id: 'survey-1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [tableQuestion, otherQuestion],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function expectedValuesOfOther(): string[] | undefined {
  return useSurveyBuilderStore
    .getState()
    .currentSurvey.questions.find((q) => q.id === 'q-other')?.displayCondition?.conditions[0]
    ?.tableConditions?.expectedValues;
}

/**
 * question-edit-modal 의 pendingOptionValueChangesRef → handleSave 글루를 최소 재현한 하네스.
 * (모달 자체의 글루는 question-edit-modal-option-value-remap.test.tsx 가 검증한다)
 */
function Harness() {
  const pendingRef = useRef<{ oldValue: string; newValue: string }[]>([]);
  const remapOptionValueInConditions = useSurveyBuilderStore(
    (s) => s.remapOptionValueInConditions,
  );

  return (
    <>
      <DynamicTableEditor
        tableTitle="표 질문"
        columns={COLUMNS}
        rows={makeRows()}
        currentQuestionId={TABLE_QUESTION_ID}
        questionCode="Q1"
        questionTitle="표 질문"
        onTableChange={() => {}}
        onOptionValueChange={(change) => {
          pendingRef.current = [...pendingRef.current, change];
        }}
      />
      <button
        type="button"
        onClick={() => {
          for (const change of pendingRef.current) {
            remapOptionValueInConditions(TABLE_QUESTION_ID, change.oldValue, change.newValue);
          }
          pendingRef.current = [];
        }}
      >
        질문 저장 시뮬레이션
      </button>
    </>
  );
}

function renderHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe('DynamicTableEditor 셀 옵션 value 변경 → 타 질문 표시조건 리매핑', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    seedSurvey();
  });

  afterEach(() => {
    cleanup();
  });

  it('셀 저장만으로는 타 질문 표시조건이 바뀌지 않고, 질문 저장 시점에 리매핑된다', () => {
    renderHarness();

    fireEvent.click(screen.getByText('컨트롤 셀'));
    fireEvent.click(screen.getByRole('button', { name: '셀 저장 시뮬레이션' }));

    // 셀 저장 단계에서는 아직 표 밖의 표시조건을 건드리지 않는다 (취소 시 미발생 원자성)
    expect(expectedValuesOfOther()).toEqual(['option-2']);

    fireEvent.click(screen.getByRole('button', { name: '질문 저장 시뮬레이션' }));

    expect(expectedValuesOfOther()).toEqual(['5']);
  });
});
