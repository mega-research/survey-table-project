/**
 * 따라 선택 (CONTEXT.md) — 보기 칸 편집 모달에서 짝을 걸고 저장하는 길.
 * 모달이 후보·죽은 짝을 정하고, 저장 확정(commitCellEdit)이 열 일괄 적용 계획을 만들어
 * 에디터(onSave)와 DB 에 같은 결과를 보낸다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateQuestionMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/survey-builder/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/features/survey-builder/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: { create: vi.fn(), update: updateQuestionMock },
    },
  },
}));

import { CellContentModal } from '@/features/survey-builder/table-editor/cell-editor/cell-content-modal';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { ChoiceGroup, Question, TableCell, TableColumn, TableRow } from '@/types/survey';

const columns: TableColumn[] = [
  { id: 'c0', label: '항목', width: 200 },
  { id: 'c1', label: '알고 있음', width: 120 },
  { id: 'c2', label: '지원 경험 있음', width: 120 },
  { id: 'c3', label: '수혜 경험 있음', width: 120 },
];
const groups: ChoiceGroup[] = [
  { id: 'g-know', groupKey: 'chk01', type: 'checkbox', label: '알고 있음' },
  { id: 'g-apply', groupKey: 'chk02', type: 'checkbox', label: '지원 경험 있음' },
  { id: 'g-benefit', groupKey: 'chk03', type: 'checkbox', label: '수혜 경험 있음' },
];
const opt = (id: string, choiceGroupId: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'choice_opt',
  content: '',
  choiceGroupId,
  ...extra,
});
const itemRow = (n: number, title: string, benefit: Partial<TableCell> = {}): TableRow => ({
  id: `r${n}`,
  label: title,
  cells: [
    { id: `item${n}`, type: 'text', content: title },
    opt(`know${n}`, 'g-know'),
    opt(`apply${n}`, 'g-apply'),
    opt(`benefit${n}`, 'g-benefit', benefit),
  ],
});

function setup(rows: TableRow[], cellId: string, overrides: Partial<Question> = {}) {
  const question: Question = {
    id: 'q1',
    type: 'table',
    title: '표',
    required: false,
    order: 1,
    tableColumns: columns,
    tableRowsData: rows,
    choiceGroups: groups,
    ...overrides,
  };
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [question],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  const onSave = vi.fn();
  render(
    <CellContentModal
      isOpen
      onClose={vi.fn()}
      cell={rows.flatMap((row) => row.cells).find((cell) => cell.id === cellId)!}
      ownQuestion={question}
      currentQuestionId="q1"
      choiceGroups={question.choiceGroups ?? []}
      getLatestRows={() => rows}
      getLatestColumns={() => question.tableColumns}
      onSave={onSave}
    />,
  );
  return { onSave };
}

const savedRows = () =>
  (updateQuestionMock.mock.calls[0]?.[0] as { data: { tableRowsData: TableRow[] } }).data
    .tableRowsData;
const savedCell = (id: string) =>
  savedRows()
    .flatMap((row) => row.cells)
    .find((cell) => cell.id === id)!;

describe('CellContentModal — 따라 선택', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('후보는 「행 제목 · 열 제목」으로 보이고, 고른 칸이 저장된다', async () => {
    const rows = [itemRow(1, '① 금융/자금 지원'), itemRow(2, '② 인력 지원')];
    const { onSave } = setup(rows, 'benefit1');

    const add = screen.getByRole('combobox', { name: '함께 고를 칸 더하기' });
    fireEvent.change(add, { target: { value: 'apply1' } });
    expect(screen.getByRole('list', { name: '함께 고를 칸' })).toHaveTextContent(
      '① 금융/자금 지원 · 지원 경험 있음',
    );

    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ id: 'benefit1', impliedCellIds: ['apply1'] });
    expect(savedCell('benefit1').impliedCellIds).toEqual(['apply1']);
    // 일괄 적용을 체크하지 않았으면 다른 칸은 그대로다
    expect(savedCell('benefit2')).not.toHaveProperty('impliedCellIds');
  });

  it('같은 열 일괄 적용을 체크하면 다른 행에도 같은 위치 관계로 걸린다 — 에디터와 DB 가 같다', async () => {
    const rows = [
      itemRow(1, '① 금융/자금 지원'),
      itemRow(2, '② 인력 지원'),
      itemRow(3, '③ 세제 지원'),
    ];
    const { onSave } = setup(rows, 'benefit1');

    fireEvent.change(screen.getByRole('combobox', { name: '함께 고를 칸 더하기' }), {
      target: { value: 'apply1' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '같은 열의 다른 보기 칸에도 같은 위치 관계로 적용 (2개)',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());

    expect(onSave.mock.calls[0]?.[2]).toEqual({
      columnImpliedSelection: { plan: { benefit2: ['apply2'], benefit3: ['apply3'] } },
    });
    expect(savedCell('benefit2').impliedCellIds).toEqual(['apply2']);
    expect(savedCell('benefit3').impliedCellIds).toEqual(['apply3']);
  });

  it('지워진 칸을 가리키던 짝은 보이지 않고, 저장하면 사라진다', async () => {
    const rows = [
      itemRow(1, '① 금융/자금 지원', { impliedCellIds: ['gone', 'apply1'] }),
      itemRow(2, '② 인력 지원'),
    ];
    setup(rows, 'benefit1');

    const list = screen.getByRole('list', { name: '함께 고를 칸' });
    expect(list.querySelectorAll('li')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(savedCell('benefit1').impliedCellIds).toEqual(['apply1']);
  });

  it('단독 선택 보기를 켜면 구역이 사라지고 짝도 걷어낸다', async () => {
    const rows = [
      itemRow(1, '① 금융/자금 지원', { impliedCellIds: ['apply1'] }),
      itemRow(2, '② 인력 지원'),
    ];
    setup(rows, 'benefit1');

    fireEvent.click(screen.getByRole('switch', { name: '단독 선택 보기' }));
    expect(screen.queryByRole('combobox', { name: '함께 고를 칸 더하기' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(savedCell('benefit1')).not.toHaveProperty('impliedCellIds');
    expect(savedCell('benefit1').exclusiveChoice).toBe(true);
  });
});

describe('CellContentModal — 따라 선택을 걸 수 있는 칸', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    updateQuestionMock.mockResolvedValue({ id: 'q1' });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // 체크박스·라디오 문항의 내장 표 — 그룹 없이 보기 칸만 있다
  const bare = (id: string, extra: Partial<TableCell> = {}): TableCell => ({
    id,
    type: 'choice_opt',
    content: '',
    ...extra,
  });
  const sourceRows = (): TableRow[] => [
    { id: 'r1', label: '세트', cells: [{ id: 't1', type: 'text', content: '세트' }, bare('set')] },
    { id: 'r2', label: 'TV', cells: [{ id: 't2', type: 'text', content: 'TV' }, bare('tv')] },
    {
      id: 'r3',
      label: '없음',
      cells: [{ id: 't3', type: 'text', content: '없음' }, bare('none', { exclusiveChoice: true })],
    },
  ];
  const sourceColumns: TableColumn[] = [
    { id: 'c0', label: '항목', width: 200 },
    { id: 'c1', label: '선택', width: 100 },
  ];
  const addBox = () => screen.queryByRole('combobox', { name: '함께 고를 칸 더하기' });

  it('체크박스 문항의 내장 표는 그룹 없는 보기 칸끼리 건다 — 단독 선택 보기는 후보가 아니다', async () => {
    setup(sourceRows(), 'set', { type: 'checkbox', choiceGroups: [], tableColumns: sourceColumns });

    const add = addBox()!;
    expect(add).toHaveTextContent('TV · 선택');
    expect(add).not.toHaveTextContent('없음');
    fireEvent.change(add, { target: { value: 'tv' } });

    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(savedCell('set').impliedCellIds).toEqual(['tv']);
  });

  it('라디오 문항의 내장 표에서는 구역이 없고, 남아 있던 짝은 저장하면 사라진다', async () => {
    const rows = sourceRows().map((row) => ({
      ...row,
      cells: row.cells.map((cell) =>
        cell.id === 'set' ? { ...cell, impliedCellIds: ['tv'] } : cell,
      ),
    }));
    setup(rows, 'set', { type: 'radio', choiceGroups: [], tableColumns: sourceColumns });
    expect(addBox()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateQuestionMock).toHaveBeenCalled());
    expect(savedCell('set')).not.toHaveProperty('impliedCellIds');
  });

  it('테이블 유형 문항의 그룹 없는 보기 칸에서는 구역이 없다 — 답할 수 없는 글자 칸이다', () => {
    setup(sourceRows(), 'set', { type: 'table', choiceGroups: [], tableColumns: sourceColumns });
    expect(addBox()).not.toBeInTheDocument();
  });

  it('라디오 그룹의 보기 칸에서는 구역이 없다', () => {
    const radioGroups: ChoiceGroup[] = groups.map((group) => ({ ...group, type: 'radio' }));
    setup([itemRow(1, '① 금융/자금 지원'), itemRow(2, '② 인력 지원')], 'benefit1', {
      choiceGroups: radioGroups,
    });
    expect(addBox()).not.toBeInTheDocument();
  });
});
