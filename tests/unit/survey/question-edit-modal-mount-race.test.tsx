import { cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 표 에디터 마운트 시점 formData 경합 재현 프로브.
 *
 * DynamicTableEditor(useTableEditor)는 마운트 시점 props 로만 state 를 초기화하고
 * 이후 props 변화를 무시한다. 모달의 formData hydrate 는 effect 라서, 콘텐츠가
 * hydrate 전에 마운트되면 에디터는 빈/이전 formData 스냅샷에 갇힌다.
 * 이 프로브는 기본 탭 위치에서 "마운트 최초 렌더의 formData" 를 캡처해 그 경합을 실측한다.
 */

vi.mock('@/components/survey-builder/question-condition-editor', () => ({
  QuestionConditionEditor: () => null,
}));
vi.mock('@/components/survey-builder/table-validation-editor', () => ({
  TableValidationEditor: () => null,
}));
vi.mock('@/hooks/use-ensure-survey-in-db', () => ({
  useEnsureSurveyInDb: () => async () => {},
}));
vi.mock('@/hooks/use-survey-sync', () => ({
  useSurveySync: () => ({ saveSurvey: vi.fn(), saveSurveyScoped: vi.fn() }),
}));
vi.mock('@/shared/lib/rpc', () => ({ client: {} }));
vi.mock('@/lib/image-extractor', () => ({ extractImageUrlsFromQuestion: () => [] }));
vi.mock('@/lib/image-utils', () => ({ deleteImagesFromR2: async () => {} }));

interface ProbeFormData {
  tableColumns?: unknown[];
  tableRowsData?: unknown[];
}

vi.mock('@/components/survey-builder/question-basic-tab', () => ({
  QuestionBasicTab: ({ formData }: { formData: ProbeFormData }) => {
    // useTableEditor 의 useState 초기화와 동일하게 최초 렌더 스냅샷을 고정
    const initialRef = useRef(formData);
    const initial = initialRef.current;
    return (
      <div
        data-testid="probe"
        data-init-cols={initial.tableColumns?.length ?? -1}
        data-init-rows={initial.tableRowsData?.length ?? -1}
        data-cur-cols={formData.tableColumns?.length ?? -1}
        data-cur-rows={formData.tableRowsData?.length ?? -1}
      />
    );
  },
}));

import { QuestionEditModal } from '@/components/survey-builder/question-edit-modal';
import { useSurveyBuilderStore } from '@/stores/survey-store';

function seedSurvey() {
  const tableQ = {
    id: 'qT',
    surveyId: 's1',
    type: 'table',
    title: '표 질문',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'col-1', label: '열1', width: 150 },
      { id: 'col-2', label: '열2', width: 150 },
      { id: 'col-3', label: '열3', width: 150 },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '행1',
        cells: [
          { id: 'c11', type: 'text', content: '' },
          { id: 'c12', type: 'text', content: '' },
          { id: 'c13', type: 'text', content: '' },
        ],
      },
      {
        id: 'r2',
        label: '행2',
        cells: [
          { id: 'c21', type: 'text', content: '' },
          { id: 'c22', type: 'text', content: '' },
          { id: 'c23', type: 'text', content: '' },
        ],
      },
    ],
  };

  useSurveyBuilderStore.getState().setSurvey({
    id: 's1',
    title: 't',
    description: '',
    slug: '',
    privateToken: 'tok',
    groups: [],
    questions: [tableQ],
    lookups: [],
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

function probeAttrs() {
  const el = screen.getByTestId('probe');
  return {
    initCols: Number(el.getAttribute('data-init-cols')),
    initRows: Number(el.getAttribute('data-init-rows')),
    curCols: Number(el.getAttribute('data-cur-cols')),
    curRows: Number(el.getAttribute('data-cur-rows')),
  };
}

describe('QuestionEditModal 표 에디터 마운트 경합', () => {
  beforeEach(() => {
    seedSurvey();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('첫 열기: 콘텐츠 마운트 최초 렌더에 formData 가 hydrate 되어 있어야 한다', () => {
    render(<QuestionEditModal questionId="qT" isOpen={true} onClose={() => {}} />);
    const a = probeAttrs();
    // 마운트 스냅샷이 하이드레이트 전({})이면 initCols = -1 로 잡힌다
    expect({ initCols: a.initCols, initRows: a.initRows }).toEqual({ initCols: 3, initRows: 2 });
  });

  it('닫았다 재열기: 재마운트 최초 렌더에도 formData 가 최신이어야 한다', () => {
    const { rerender } = render(
      <QuestionEditModal questionId="qT" isOpen={true} onClose={() => {}} />,
    );
    // 닫기 (저장 없이 취소와 동일 — questionId 유지 여부 두 케이스 중 유지 케이스)
    rerender(<QuestionEditModal questionId="qT" isOpen={false} onClose={() => {}} />);
    // 재열기
    rerender(<QuestionEditModal questionId="qT" isOpen={true} onClose={() => {}} />);
    const a = probeAttrs();
    expect({ initCols: a.initCols, initRows: a.initRows }).toEqual({ initCols: 3, initRows: 2 });
  });

  it('닫힐 때 questionId 가 해제되는 케이스: 재열기 마운트 스냅샷도 최신이어야 한다', () => {
    const { rerender } = render(
      <QuestionEditModal questionId="qT" isOpen={true} onClose={() => {}} />,
    );
    rerender(<QuestionEditModal questionId={null} isOpen={false} onClose={() => {}} />);
    rerender(<QuestionEditModal questionId="qT" isOpen={true} onClose={() => {}} />);
    const a = probeAttrs();
    expect({ initCols: a.initCols, initRows: a.initRows }).toEqual({ initCols: 3, initRows: 2 });
  });
});
