import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 다단계 헤더 토글 OFF 가 저장되지 않는 회귀 테스트.
 *
 * 배경: 표 에디터의 "다단계 헤더" 토글을 끄면 headerGrid 가 사라져야 하는데,
 * 저장 경로 전 구간이 "키 부재 = 미변경" 규약이라 해제를 표현할 방법이 없었다.
 *   - use-table-editor: 토글 OFF 시 tableHeaderGrid 키를 아예 빼고 알림
 *   - store.updateQuestion: Object.assign — 부재 키는 기존 값 유지
 *   - questions.update service: `value !== undefined` 만 SET — 부재 키는 미변경
 * 결과적으로 토글을 꺼도 DB/스토어의 headerGrid 가 그대로 남아 다시 열면 ON 이었다.
 *
 * 해제 신호는 명시적 null (groupId 해제와 동일 규약).
 */

const updateMock = vi.fn(async (_input: { data?: { tableHeaderGrid?: unknown } }) => ({ id: 'qT' }));

vi.mock('@/components/survey-builder/question-condition-editor', () => ({
  QuestionConditionEditor: () => null,
}));
vi.mock('@/components/survey-builder/table-validation-editor', () => ({
  TableValidationEditor: () => null,
}));
vi.mock('@/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: {
        update: (input: { data?: { tableHeaderGrid?: unknown } }) => updateMock(input),
      },
    },
  },
}));
vi.mock('@/lib/image-extractor', () => ({ extractImageUrlsFromQuestion: () => [] }));
vi.mock('@/lib/image-utils', () => ({ deleteImagesFromR2: async () => {} }));

// 실제 기본 탭(TipTap 등)은 무겁다 — 표 에디터가 하는 일(헤더 그리드 해제)만 흉내낸다.
vi.mock('@/components/survey-builder/question-basic-tab', () => ({
  QuestionBasicTab: ({
    setFormData,
  }: {
    setFormData: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        // dynamic-table-editor 의 다단계 헤더 토글 OFF 가 formData 에 남기는 결과
        setFormData((prev) => ({ ...prev, tableHeaderGrid: null }))
      }
    >
      헤더토글끄기
    </button>
  ),
}));

import { useTableEditor } from '@/components/survey-builder/hooks/use-table-editor';
import { QuestionEditModal } from '@/components/survey-builder/question-edit-modal';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { HeaderCell, TableColumn, TableRow } from '@/types/survey';

const COLUMNS: TableColumn[] = [
  { id: 'col-1', label: '열 1', columnCode: 'c1', width: 150 },
  { id: 'col-2', label: '열 2', columnCode: 'c2', width: 150 },
];

const HEADER_GRID: HeaderCell[][] = [
  [{ id: 'h-1', label: '상위 헤더', colspan: 2, rowspan: 1 }],
  [
    { id: 'h-2', label: '열 1', colspan: 1, rowspan: 1 },
    { id: 'h-3', label: '열 2', colspan: 1, rowspan: 1 },
  ],
];

function makeRows(): TableRow[] {
  return [
    {
      id: 'row-1',
      label: '행 1',
      height: 60,
      minHeight: 40,
      cells: [
        { id: 'cell-1-1', content: '', type: 'text' },
        { id: 'cell-1-2', content: '', type: 'text' },
      ],
    },
  ];
}

describe('useTableEditor.toggleMultiRowHeader — 해제 신호', () => {
  it('토글을 끄면 tableHeaderGrid: null 로 명시적 해제를 알린다', () => {
    const onTableChange = vi.fn();
    const hook = renderHook(() =>
      useTableEditor({
        tableTitle: '표 질문',
        columns: COLUMNS,
        rows: makeRows(),
        tableHeaderGrid: HEADER_GRID,
        currentQuestionId: 'qT',
        questionCode: 'Q1',
        questionTitle: '표 질문',
        onTableChange,
      }),
    );

    act(() => {
      hook.result.current.actions.toggleMultiRowHeader(false);
    });

    const payload = onTableChange.mock.calls.at(-1)?.[0];
    // 키를 생략하면 하위 저장 경로가 "미변경"으로 읽어 해제가 유실된다.
    expect(payload).toHaveProperty('tableHeaderGrid');
    expect(payload?.tableHeaderGrid).toBeNull();
    expect(hook.result.current.state.currentHeaderGrid).toBeUndefined();
  });
});

function seedSurvey() {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [
      {
        id: 'qT',
        surveyId: 's1',
        type: 'table',
        title: '표 질문',
        required: false,
        order: 0,
        tableColumns: COLUMNS,
        tableRowsData: makeRows(),
        tableHeaderGrid: HEADER_GRID,
      },
    ],
    lookups: [],
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

function headerGridOf(id: string) {
  return useSurveyBuilderStore
    .getState()
    .currentSurvey.questions.find((q) => q.id === id)?.tableHeaderGrid;
}

describe('QuestionEditModal — 다단계 헤더 해제 저장', () => {
  beforeEach(() => {
    seedSurvey();
    updateMock.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('헤더 토글을 끄고 저장하면 스토어와 UPDATE 페이로드 모두 해제된다', async () => {
    render(<QuestionEditModal questionId="qT" isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByText('헤더토글끄기'));

    await act(async () => {
      fireEvent.click(screen.getByText('저장'));
    });

    expect(headerGridOf('qT')).toBeFalsy();

    const call = updateMock.mock.calls.at(-1)?.[0] as
      | { data?: { tableHeaderGrid?: unknown } }
      | undefined;
    expect(call?.data).toHaveProperty('tableHeaderGrid');
    expect(call?.data?.tableHeaderGrid).toBeNull();
  });
});
