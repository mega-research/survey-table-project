/**
 * commitCellEdit 직접 단위 테스트.
 *
 * 3차 분할이 이 절차를 모달 밖으로 뺀 명분은 "UI 수명주기를 모르므로 따로 읽고 테스트할 수
 * 있다" 였는데, 형제인 validate-cell-edit 만 테스트를 얻고 이쪽은 0 이었다(2026-08-25 리뷰).
 *
 * 겨누는 것은 이 모듈 주석이 스스로 "과거에 깨졌다" 고 지목한 불변식들이다:
 *  - onSave 가 onChoiceGroupsChange 보다 먼저 (prune 이 새 셀을 포함한 상태를 봐야 한다)
 *  - 저장 베이스는 store 가 아니라 에디터 최신 행 (store 는 구조 편집 중 stale)
 *  - 열·헤더그리드를 행과 짝으로 커밋 (혼합 상태 = 그리드 스크램블, 2026-08-19 실사고)
 *  - 신규 판정은 questionChanges.added 기준 (UUID 형식 검사로는 미영속 질문을 못 가른다)
 *  - 빈 그룹 prune, 단 원래 그룹이 없던 질문은 NULL 유지
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateQuestionMock = vi.hoisted(() => vi.fn());
const createQuestionMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: { create: createQuestionMock, update: updateQuestionMock },
    },
  },
}));

import { commitCellEdit } from '@/features/survey-builder/table-editor/cell-editor/commit-cell-edit';
import { cellToFormState } from '@/features/survey-builder/table-editor/cell-editor/utils/serialize-cell';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { ChoiceGroup, Question, TableCell, TableColumn, TableRow } from '@/types/survey';

const CELL: TableCell = { id: 'c11', type: 'text', content: '원래 내용' };

/** store 에 남아 있는 낡은 행 — 열 2개 시절. 저장 베이스로 쓰이면 안 된다. */
const STALE_ROWS: TableRow[] = [
  { id: 'r1', label: '행1', cells: [CELL, { id: 'c12', type: 'text', content: '' }] },
];

/** 에디터의 권위 있는 최신 행 — 열 3개로 늘어난 상태. */
const LATEST_ROWS: TableRow[] = [
  {
    id: 'r1',
    label: '행1',
    cells: [CELL, { id: 'c12', type: 'text', content: '' }, { id: 'c13', type: 'text', content: '' }],
  },
];
const LATEST_COLUMNS: TableColumn[] = [
  { id: 'col-1', label: '열1', width: 150 },
  { id: 'col-2', label: '열2', width: 150 },
  { id: 'col-3', label: '열3', width: 150 },
];

function seedStore(question: Question, opts: { added?: boolean } = {}) {
  const store = useSurveyBuilderStore.getState();
  store.resetSurvey();
  store.setSurvey({
    id: 'survey-1',
    title: '설문',
    description: '',
    questions: [question],
    groups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  if (opts.added) {
    useSurveyBuilderStore.setState((state) => ({
      questionChanges: {
        ...state.questionChanges,
        added: { ...state.questionChanges.added, [question.id]: true },
      },
    }));
  }
}

function tableQuestion(over: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'table',
    title: '표 문항',
    required: false,
    order: 0,
    tableRowsData: STALE_ROWS,
    ...over,
  } as Question;
}

function args(over: Record<string, unknown> = {}) {
  const question = (over['question'] as Question) ?? tableQuestion();
  return {
    form: cellToFormState({ ...CELL, content: '바뀐 내용' }),
    cell: CELL,
    questionCode: undefined,
    currentQuestionId: 'q1',
    questions: [question],
    editChoiceGroups: [] as ChoiceGroup[],
    pendingValueChanges: [] as { oldValue: string; newValue: string }[],
    latest: { rows: () => LATEST_ROWS, columns: () => LATEST_COLUMNS },
    ensureSurvey: vi.fn(async () => {}),
    saveSurveyScoped: vi.fn(async () => undefined),
    remapOptionValueInConditions: vi.fn(),
    onSave: vi.fn(),
    onChoiceGroupsChange: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  updateQuestionMock.mockReset().mockResolvedValue({});
  createQuestionMock.mockReset().mockResolvedValue({ id: 'q-new' });
});

describe('commitCellEdit — 저장 베이스와 커밋 짝', () => {
  it('store 의 낡은 행이 아니라 에디터 최신 행을 베이스로 저장한다', async () => {
    const question = tableQuestion();
    seedStore(question);
    await commitCellEdit(args({ question }) as never);

    expect(updateQuestionMock).toHaveBeenCalledTimes(1);
    const sent = updateQuestionMock.mock.calls[0]![0].data.tableRowsData as TableRow[];
    // 최신 행은 셀 3개 — store 의 stale 행(2개)이 베이스였다면 여기서 갈린다.
    expect(sent[0]!.cells).toHaveLength(3);
  });

  it('편집한 셀이 최신 행 안에서 갱신된 값으로 실린다', async () => {
    const question = tableQuestion();
    seedStore(question);
    await commitCellEdit(args({ question }) as never);

    const sent = updateQuestionMock.mock.calls[0]![0].data.tableRowsData as TableRow[];
    expect(sent[0]!.cells[0]).toMatchObject({ id: 'c11', content: '바뀐 내용' });
  });

  it('열을 행과 같은 커밋에 실어 보낸다 — 혼합 상태 방지', async () => {
    const question = tableQuestion();
    seedStore(question);
    await commitCellEdit(args({ question }) as never);

    expect(updateQuestionMock.mock.calls[0]![0].data.tableColumns).toEqual(LATEST_COLUMNS);
  });

  it('headerGrid 는 배선되지 않으면 키 자체를 싣지 않는다 — 키 부재 = 미변경 규약', async () => {
    const question = tableQuestion();
    seedStore(question);
    await commitCellEdit(args({ question }) as never);

    expect('tableHeaderGrid' in updateQuestionMock.mock.calls[0]![0].data).toBe(false);
  });

  it('headerGrid 가 배선됐고 값이 없으면 명시적 null 로 해제한다', async () => {
    const question = tableQuestion();
    seedStore(question);
    await commitCellEdit(
      args({ question, latest: { rows: () => LATEST_ROWS, headerGrid: () => undefined } }) as never,
    );

    expect(updateQuestionMock.mock.calls[0]![0].data.tableHeaderGrid).toBeNull();
  });
});

describe('commitCellEdit — 호출 순서', () => {
  it('onSave 를 onChoiceGroupsChange 보다 먼저 부른다', async () => {
    const order: string[] = [];
    const question = tableQuestion({
      tableRowsData: [
        { id: 'r1', label: '행1', cells: [{ id: 'c11', type: 'choice_opt', content: 'A' }] },
      ],
    });
    seedStore(question);
    const choiceCell: TableCell = { id: 'c11', type: 'choice_opt', content: 'A' };
    await commitCellEdit(
      args({
        question,
        cell: choiceCell,
        form: cellToFormState(choiceCell),
        latest: { rows: () => question.tableRowsData! },
        onSave: vi.fn(() => void order.push('onSave')),
        onChoiceGroupsChange: vi.fn(() => void order.push('onChoiceGroupsChange')),
      }) as never,
    );

    // prune 은 이 셀이 반영된 뒤의 행을 봐야 한다 — 순서가 뒤집히면 그룹 멤버를 놓친다.
    expect(order).toEqual(['onSave', 'onChoiceGroupsChange']);
  });
});

describe('commitCellEdit — 신규 질문 판정', () => {
  it('questionChanges.added 에 있으면 update 가 아니라 create 로 간다', async () => {
    const question = tableQuestion();
    seedStore(question, { added: true });
    await commitCellEdit(args({ question }) as never);

    // UUID 형식 검사로 판정하던 시절에는 로컬 id 도 randomUUID 라 미영속 질문이
    // update 로 새어 0행 UPDATE 로 조용히 저장 실패했다.
    expect(createQuestionMock).toHaveBeenCalledTimes(1);
    expect(updateQuestionMock).not.toHaveBeenCalled();
  });

  it('added 에 없으면 update 로 간다', async () => {
    const question = tableQuestion();
    seedStore(question);
    await commitCellEdit(args({ question }) as never);

    expect(updateQuestionMock).toHaveBeenCalledTimes(1);
    expect(createQuestionMock).not.toHaveBeenCalled();
  });
});

describe('commitCellEdit — choiceGroups prune', () => {
  it('멤버가 사라진 그룹은 저장에서 빠진다', async () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        label: '행1',
        cells: [{ id: 'c11', type: 'choice_opt', content: 'A', choiceGroupId: 'g1' }],
      },
    ];
    const question = tableQuestion({
      tableRowsData: rows,
      choiceGroups: [
        { id: 'g1', groupKey: 'rad1', type: 'radio', label: '그룹1' },
        { id: 'g2', groupKey: 'rad2', type: 'radio', label: '빈 그룹' },
      ] satisfies ChoiceGroup[],
    });
    seedStore(question);
    const choiceCell = rows[0]!.cells[0]!;
    await commitCellEdit(
      args({
        question,
        cell: choiceCell,
        form: cellToFormState(choiceCell),
        editChoiceGroups: question.choiceGroups,
        latest: { rows: () => rows },
      }) as never,
    );

    const sentGroups = updateQuestionMock.mock.calls[0]![0].data.choiceGroups as ChoiceGroup[];
    expect(sentGroups.map((g) => g.id)).toEqual(['g1']);
  });

  it('원래 그룹이 없던 질문이면 빈 배열을 쓰지 않는다 — NULL 유지', async () => {
    const rows: TableRow[] = [
      { id: 'r1', label: '행1', cells: [{ id: 'c11', type: 'choice_opt', content: 'A' }] },
    ];
    const question = tableQuestion({ tableRowsData: rows });
    seedStore(question);
    const choiceCell = rows[0]!.cells[0]!;
    await commitCellEdit(
      args({
        question,
        cell: choiceCell,
        form: cellToFormState(choiceCell),
        latest: { rows: () => rows },
      }) as never,
    );

    expect('choiceGroups' in updateQuestionMock.mock.calls[0]![0].data).toBe(false);
  });
});
