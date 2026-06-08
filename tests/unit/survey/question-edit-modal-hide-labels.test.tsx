import { render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 무거운 자식 탭(TipTap 등)을 stub 처리 — 검증 대상은 모달의 라이프사이클 effect 뿐이다.
vi.mock('@/components/survey-builder/question-basic-tab', () => ({
  QuestionBasicTab: () => null,
}));
vi.mock('@/components/survey-builder/question-condition-editor', () => ({
  QuestionConditionEditor: () => null,
}));
vi.mock('@/components/survey-builder/table-validation-editor', () => ({
  TableValidationEditor: () => null,
}));
vi.mock('@/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/shared/lib/rpc', () => ({ client: {} }));
vi.mock('@/lib/image-extractor', () => ({ extractImageUrlsFromQuestion: () => [] }));
vi.mock('@/lib/image-utils', () => ({ deleteImagesFromR2: async () => {} }));

import { QuestionEditModal } from '@/components/survey-builder/question-edit-modal';
import { useSurveyBuilderStore } from '@/stores/survey-store';

function seedSurvey() {
  const questionA = {
    id: 'qA',
    surveyId: 's1',
    type: 'radio',
    title: '질문 A',
    required: false,
    order: 0,
    options: [{ id: 'o1', label: '옵션1', value: '1' }],
    // hideColumnLabels 미설정(기본 false)
  };
  const questionB = {
    id: 'qB',
    surveyId: 's1',
    type: 'table',
    title: '표 질문 B',
    required: false,
    order: 1,
    tableColumns: [],
    tableRowsData: [],
    hideColumnLabels: true, // 열 라벨 숨김 ON
  };

  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [questionA, questionB],
    lookups: [],
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

function hideLabelsOf(id: string): boolean | undefined {
  return useSurveyBuilderStore
    .getState()
    .currentSurvey.questions.find((q) => q.id === id)?.hideColumnLabels;
}

describe('QuestionEditModal hideColumnLabels 롤백', () => {
  beforeEach(() => {
    seedSurvey();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('질문 A 편집을 닫고 표 질문 B를 열어도 B의 hideColumnLabels(true)가 유지된다', () => {
    const onClose = () => {};
    const { rerender } = render(
      <QuestionEditModal questionId="qA" isOpen onClose={onClose} />,
    );

    // A 편집 닫기 (editingQuestionId: A -> null)
    rerender(<QuestionEditModal questionId={null} isOpen={false} onClose={onClose} />);

    // 표 질문 B 열기 (null -> B)
    rerender(<QuestionEditModal questionId="qB" isOpen onClose={onClose} />);

    // B를 연 것만으로 hideColumnLabels가 직전 질문 값으로 덮어써지면 안 된다.
    expect(hideLabelsOf('qB')).toBe(true);
  });

  it('질문 A에서 표 질문 B로 모달을 닫지 않고 바로 전환해도 B가 유지된다', () => {
    const onClose = () => {};
    const { rerender } = render(
      <QuestionEditModal questionId="qA" isOpen onClose={onClose} />,
    );

    // 모달을 닫지 않고 A -> B 직접 전환
    rerender(<QuestionEditModal questionId="qB" isOpen onClose={onClose} />);

    expect(hideLabelsOf('qB')).toBe(true);
  });

  it('모달 안에서 토글한 hideColumnLabels는 저장 없이 닫으면 원래값으로 롤백된다', () => {
    const onClose = () => {};
    const { rerender } = render(
      <QuestionEditModal questionId="qB" isOpen onClose={onClose} />,
    );

    // 사용자가 모달 안에서 열 라벨 숨김을 OFF 로 토글 (silent)
    useSurveyBuilderStore.getState().silentUpdateQuestion('qB', { hideColumnLabels: false });
    expect(hideLabelsOf('qB')).toBe(false);

    // 저장 없이 닫음 -> 원래값(true)으로 롤백되어야 한다
    rerender(<QuestionEditModal questionId={null} isOpen={false} onClose={onClose} />);

    expect(hideLabelsOf('qB')).toBe(true);
  });
});
