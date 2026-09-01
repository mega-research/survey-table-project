import { useRef, useState } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuestionBasicTab } from '@/components/survey-builder/question-basic-tab';
import {
  createAddLevelOption,
  createAddOption,
  createAddSelectLevel,
  createRemoveLevelOption,
  createRemoveOption,
  createRemoveSelectLevel,
  createUpdateLevelOption,
  createUpdateOption,
  createUpdateOptionWithParent,
  createUpdateSelectLevel,
} from '@/components/survey-builder/question-option-helpers';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { Question, QuestionGroup } from '@/types/survey';

/**
 * 질문 편집 모달의 "그룹 선택" 드롭다운은 그룹 트리를 깊이에 상관없이 전부 보여야 한다.
 * 3단계 그룹이 빠지면 그 그룹으로 질문을 옮길 방법이 없다.
 */

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => null,
}));
vi.mock('@/components/survey-builder/dynamic-table-editor', () => ({
  DynamicTableEditor: () => null,
}));

function Harness({ question }: { question: Question }) {
  const [formData, setFormData] = useState<Partial<Question>>({ title: question.title });
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showBranchSettings, setShowBranchSettings] = useState(false);
  const [localTitle, setLocalTitle] = useState(question.title);
  const [localExportLabel, setLocalExportLabel] = useState('');
  const debouncedTitleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedExportLabelRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <QuestionBasicTab
      question={question}
      questionId={question.id}
      questions={[question]}
      formData={formData}
      setFormData={setFormData}
      validationErrors={validationErrors}
      setValidationErrors={setValidationErrors}
      showBranchSettings={showBranchSettings}
      setShowBranchSettings={setShowBranchSettings}
      localTitle={localTitle}
      setLocalTitle={setLocalTitle}
      localExportLabel={localExportLabel}
      setLocalExportLabel={setLocalExportLabel}
      debouncedTitleRef={debouncedTitleRef}
      debouncedExportLabelRef={debouncedExportLabelRef}
      addOption={createAddOption(setFormData)}
      updateOption={createUpdateOption(setFormData)}
      removeOption={createRemoveOption(setFormData)}
      addSelectLevel={createAddSelectLevel(setFormData)}
      updateSelectLevel={createUpdateSelectLevel(setFormData)}
      removeSelectLevel={createRemoveSelectLevel(setFormData)}
      addLevelOption={createAddLevelOption(setFormData)}
      updateOptionWithParent={createUpdateOptionWithParent(setFormData)}
      updateLevelOption={createUpdateLevelOption(setFormData)}
      removeLevelOption={createRemoveLevelOption(setFormData)}
    />
  );
}

const groups: QuestionGroup[] = [
  { id: 'g1', surveyId: 's1', name: '최상위 그룹', order: 0 },
  { id: 'g2', surveyId: 's1', name: '하위 그룹', order: 0, parentGroupId: 'g1' },
  { id: 'g3', surveyId: 's1', name: '손자 그룹', order: 0, parentGroupId: 'g2' },
];

const question = {
  id: 'q1',
  type: 'text',
  title: '질문',
  required: false,
  order: 0,
} as unknown as Question;

describe('QuestionBasicTab 그룹 선택 — 3단계 그룹', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    useSurveyBuilderStore.getState().setSurvey({
      id: 's1',
      title: 't',
      description: '',
      slug: '',
      privateToken: 'tok',
      groups,
      questions: [question],
      lookups: [],
      settings: useSurveyBuilderStore.getState().currentSurvey.settings,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
  afterEach(() => cleanup());

  it('하위 그룹의 하위 그룹도 선택지에 깊이 들여쓰기로 나온다', () => {
    render(<Harness question={question} />);
    const select = screen.getByLabelText('그룹 선택 (선택사항)') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['그룹 없음', '최상위 그룹', '└─ 하위 그룹', '　└─ 손자 그룹']);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'g1', 'g2', 'g3']);
  });
});
