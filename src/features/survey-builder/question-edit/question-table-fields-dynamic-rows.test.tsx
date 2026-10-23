import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { QuestionTableFields } from '@/features/survey-builder/question-edit/question-table-fields';
import type { DynamicRowGroupConfig, Question, TableColumn, TableRow } from '@/types/survey';

/**
 * 마지막 동적 행 그룹을 지우면 해제가 저장되지 않던 회귀.
 *
 * 표 에디터는 남은 그룹이 없으면 undefined 를 올렸고, 이 구획은 그때 formData 의 키를 지웠다.
 * store.updateQuestion(Object.assign)과 questions.update(`value !== undefined`)는 빠진 키를
 * "미변경"으로 읽으므로 옛 그룹이 DB 에 남아, 다시 열면 지운 그룹이 되살아났다.
 * 해제 신호는 키가 살아 있는 빈 배열이다(다단계 헤더 해제와 같은 규약).
 */

vi.mock('@/features/survey-builder/stores/survey-store', () => ({
  useSurveyBuilderStore: <T,>(
    selector: (state: {
      currentSurvey: { questions: { id: string }[] };
      silentUpdateQuestion: () => void;
    }) => T,
  ) =>
    selector({
      currentSurvey: { questions: [{ id: 'other' }] },
      silentUpdateQuestion: () => {},
    }),
}));

vi.mock('@/features/survey-builder/stores/ui-store', () => ({
  useSurveyUIStore: <T,>(selector: (state: { editingQuestionId: string | null }) => T) =>
    selector({ editingQuestionId: null }),
}));

const columns: TableColumn[] = [
  { id: 'col-1', label: '항목', width: 150 },
  { id: 'col-2', label: '값', width: 150 },
];
const rows: TableRow[] = [
  {
    id: 'row-1',
    label: '첫째 행',
    dynamicGroupId: 'g1',
    cells: [
      { id: 'c11', content: '항목', type: 'text' },
      { id: 'c12', content: '', type: 'input' },
    ],
  },
];
const group: DynamicRowGroupConfig = {
  groupId: 'g1',
  label: '그룹 1',
  enabled: true,
} as DynamicRowGroupConfig;

const question = {
  id: 'qT',
  surveyId: 's1',
  type: 'table',
  title: '표 질문',
  required: false,
  order: 0,
} as Question;

function Harness({ onFormData }: { onFormData: (data: Partial<Question>) => void }) {
  const [formData, setFormData] = useState<Partial<Question>>({
    type: 'table',
    tableColumns: columns,
    tableRowsData: rows,
    dynamicRowConfigs: [group],
  });
  onFormData(formData);
  return (
    <QuestionTableFields
      question={question}
      questionId="qT"
      questions={[question]}
      formData={formData}
      setFormData={setFormData}
      answerQuoteEnabled={false}
      isRankingTableSource={false}
      showTableEditor
      tableEditorEpoch={0}
    />
  );
}

describe('QuestionTableFields — 마지막 동적 행 그룹 삭제', () => {
  it('키를 지우지 않고 빈 배열로 해제를 남긴다', () => {
    let latest: Partial<Question> = {};
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Harness onFormData={(d) => (latest = d)} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTitle('그룹 삭제'));

    expect(latest).toHaveProperty('dynamicRowConfigs');
    expect(latest.dynamicRowConfigs).toEqual([]);
  });
});
