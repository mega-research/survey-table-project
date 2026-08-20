/**
 * 회귀: 셀 저장의 CREATE 분기(미영속 질문)가 질문 레벨 필드를 페이로드에서 빠뜨리면,
 * 표 셀을 먼저 저장한 신규 질문이 hideTitle·pageBreakBefore·hideColumnLabels·SPSS 필드·
 * choiceGroups 를 NULL 로 생성한다. 스토어에 이미 커밋된 값이므로 CREATE 페이로드는
 * PERSISTED_QUESTION_FIELDS 전부를 실어야 한다 (question-edit-modal 과 같은 계약).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createQuestionMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn(), saveSurveyScoped: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      questions: { create: createQuestionMock, update: vi.fn() },
    },
  },
}));

import { CellContentModal } from '@/components/survey-builder/cell-content-modal';
import { PERSISTED_QUESTION_FIELDS } from '@/db/schema/question-persisted-fields';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { ChoiceGroup, Question, TableCell, TableColumn, TableRow } from '@/types/survey';

const editedCell: TableCell = { id: 'c11', type: 'text', content: '셀' };
const columns: TableColumn[] = [{ id: 'col-1', label: '열1', width: 150 }];
const rows: TableRow[] = [{ id: 'r1', label: '행1', cells: [editedCell] }];
const groups: ChoiceGroup[] = [{ id: 'g1', groupKey: 'rad1', type: 'radio', label: '그룹1' }];

// 질문 모달에서 이미 스토어로 커밋됐지만 아직 DB 에 없는 질문 레벨 설정들
const storeQuestion: Question = {
  id: 'q1',
  type: 'table',
  title: '표',
  required: false,
  order: 1,
  requiredMessage: '응답이 필요합니다',
  tableColumns: columns,
  tableRowsData: rows,
  choiceGroups: groups,
  hideTitle: true,
  pageBreakBefore: true,
  hideColumnLabels: true,
  piiEncrypted: true,
  questionCode: 'Q7',
  isCustomSpssVarName: true,
  exportLabel: '표질문',
  exportCellOrder: 'column-first',
  spssVarType: 'String',
  spssMeasure: 'Ordinal',
  answerQuoteEnabled: true,
  answerQuoteName: '표인용',
  mobileTableDisplayMode: 'drilldown-original-row',
  mobileDrilldownOmitLeadingColumns: 2,
};

function seedUnpersistedQuestion() {
  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [storeQuestion],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  // 미영속 질문 마킹 — CREATE 분기 진입 조건. setSurvey 가 changeset 을 비우므로 그 뒤에 둔다.
  useSurveyBuilderStore.setState((state) => ({
    questionChanges: { ...state.questionChanges, added: { q1: true } },
  }));
}

async function saveCellOnce() {
  render(
    <CellContentModal
      isOpen
      onClose={vi.fn()}
      cell={editedCell}
      ownQuestion={storeQuestion}
      currentQuestionId="q1"
      getLatestRows={() => rows}
      getLatestColumns={() => columns}
      getLatestHeaderGrid={() => undefined}
      onSave={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(createQuestionMock).toHaveBeenCalledTimes(1));
  return createQuestionMock.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('CellContentModal CREATE 분기의 영속 필드 커버리지', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    createQuestionMock.mockResolvedValue({ id: 'q1' });
    seedUnpersistedQuestion();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('PERSISTED_QUESTION_FIELDS 전 항목이 create 페이로드에 실린다', async () => {
    const payload = await saveCellOnce();
    const missing = PERSISTED_QUESTION_FIELDS.filter((field) => !(field in payload));
    expect(missing).toEqual([]);
  });

  it('스토어에만 있던 질문 레벨 값이 create 로 전달된다', async () => {
    const payload = await saveCellOnce();
    expect(payload).toEqual(
      expect.objectContaining({
        requiredMessage: '응답이 필요합니다',
        hideTitle: true,
        pageBreakBefore: true,
        hideColumnLabels: true,
        piiEncrypted: true,
        questionCode: 'Q7',
        isCustomSpssVarName: true,
        exportLabel: '표질문',
        exportCellOrder: 'column-first',
        spssVarType: 'String',
        spssMeasure: 'Ordinal',
        answerQuoteEnabled: true,
        answerQuoteName: '표인용',
        mobileTableDisplayMode: 'drilldown-original-row',
        mobileDrilldownOmitLeadingColumns: 2,
        choiceGroups: groups,
      }),
    );
  });
});
