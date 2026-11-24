/**
 * commitCellEdit — 문항의 슬라이더 방향 보존.
 *
 * 묶음 없는 보기 소스 표(라디오 문항 + 내장 표)는 문항 필드로 슬라이더를 켠다. 아직 저장되지 않은 그 문항의
 * 표 칸을 고치면 셀 모달이 문항을 통째로 CREATE 한다 — 그 필드 나열에서 빠지면 칸 하나를 고친 것만으로
 * 슬라이더가 꺼진 채 저장된다. 이미 저장된 문항은 표 구조만 부분 수정하므로 방향을 건드리지 않아야 한다.
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

const CELL: TableCell = { id: 'c11', type: 'text', content: '항목' };
const ROWS: TableRow[] = [
  { id: 'r1', label: '행1', cells: [CELL, { id: 'c12', type: 'choice_opt', content: '매우 만족' }] },
];
const COLUMNS: TableColumn[] = [
  { id: 'col-1', label: '항목', width: 150 },
  { id: 'col-2', label: '5', width: 150 },
];

const sliderQuestion = {
  id: 'q1',
  type: 'radio',
  title: '보기 소스 표',
  required: false,
  order: 0,
  tableColumns: COLUMNS,
  tableRowsData: ROWS,
  scaleSlider: 'positive-left',
} as unknown as Question;

function seedStore(opts: { added: boolean }) {
  const store = useSurveyBuilderStore.getState();
  store.resetSurvey();
  store.setSurvey({
    id: 'survey-1',
    title: '설문',
    description: '',
    questions: [sliderQuestion],
    groups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  if (opts.added) {
    useSurveyBuilderStore.setState((state) => ({
      questionChanges: {
        ...state.questionChanges,
        added: { ...state.questionChanges.added, q1: true },
      },
    }));
  }
}

function args() {
  return {
    form: cellToFormState({ ...CELL, content: '바뀐 항목' }),
    cell: CELL,
    questionCode: undefined,
    currentQuestionId: 'q1',
    questions: [sliderQuestion],
    editChoiceGroups: [] as ChoiceGroup[],
    pendingValueChanges: [] as { oldValue: string; newValue: string }[],
    latest: { rows: () => ROWS, columns: () => COLUMNS },
    ensureSurvey: vi.fn(async () => {}),
    saveSurveyScoped: vi.fn(async () => undefined),
    remapOptionValueInConditions: vi.fn(),
    onSave: vi.fn(),
    onChoiceGroupsChange: vi.fn(),
  };
}

const storeDirection = () =>
  useSurveyBuilderStore.getState().currentSurvey.questions.find((q) => q.id === 'q1')?.scaleSlider;

beforeEach(() => {
  updateQuestionMock.mockReset().mockResolvedValue({});
  createQuestionMock.mockReset().mockResolvedValue({ id: 'q1' });
});

describe('commitCellEdit — 문항의 슬라이더 방향 보존', () => {
  it('아직 저장되지 않은 문항의 칸을 고치면 CREATE 에 방향이 실린다', async () => {
    seedStore({ added: true });
    await commitCellEdit(args() as never);

    expect(createQuestionMock).toHaveBeenCalledTimes(1);
    expect(createQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({ scaleSlider: 'positive-left' }),
    );
    expect(storeDirection()).toBe('positive-left');
  });

  it('저장된 문항의 칸을 고치는 부분 수정은 방향을 싣지 않고 스토어 값도 그대로다', async () => {
    seedStore({ added: false });
    await commitCellEdit(args() as never);

    expect(updateQuestionMock).toHaveBeenCalledTimes(1);
    const data = updateQuestionMock.mock.calls[0]![0].data as Record<string, unknown>;
    expect('scaleSlider' in data).toBe(false);
    expect(storeDirection()).toBe('positive-left');
  });
});
