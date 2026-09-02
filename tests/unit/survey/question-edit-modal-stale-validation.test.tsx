import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 회귀 테스트: 검증 에러 상태의 질문 간 누수 + 저장 데드락.
 *
 * validationErrors 는 모달 컴포넌트 state 인데 질문 전환/재오픈 hydrate 가
 * 리셋하지 않았고, 저장 버튼은 에러가 있으면 비활성이었다. 그 결과:
 * 1) radio 설명 테이블 질문에서 "보기 옵션 셀 필요" 에러가 뜬 뒤 다른 질문
 *    (멀쩡한 표 질문 포함)을 열어도 에러 배너가 남고 저장이 막힌다.
 * 2) 같은 세션에서 문제를 고쳐도(셀 모달 경로는 에러 키를 못 지움) 저장이
 *    비활성이라 재검증 자체가 불가능한 데드락.
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
vi.mock('@/components/survey-builder/question-basic-tab', () => ({
  QuestionBasicTab: () => null,
}));

import { QuestionEditModal } from '@/components/survey-builder/question-edit-modal';
import { useSurveyBuilderStore } from '@/stores/survey-store';

function seedSurvey() {
  // DQ7 형태: radio + 설명 테이블(tableColumns 존재) + choice_opt 0개 → 저장 차단 대상
  const brokenRadioQ = {
    id: 'qR',
    surveyId: 's1',
    type: 'radio',
    title: 'DQ7. 매출액',
    required: false,
    order: 0,
    options: [],
    tableColumns: [
      { id: 'col-1', label: '항목', width: 150 },
      { id: 'col-2', label: '선택', width: 150 },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '행1',
        cells: [
          { id: 'c11', type: 'text', content: '2025' },
          {
            id: 'c12',
            type: 'radio',
            content: '',
            radioOptions: [
              { id: 'o1', label: '매출액' },
              { id: 'o2', label: '매출액 없음' },
            ],
          },
        ],
      },
    ],
  };

  // 멀쩡한 표 질문 — 이 질문의 모달에는 어떤 에러도 떠서는 안 된다
  const tableQ = {
    id: 'qT',
    surveyId: 's1',
    type: 'table',
    title: '테이블 질문',
    required: false,
    order: 1,
    tableColumns: [
      { id: 'tc-1', label: '열1', width: 150 },
      { id: 'tc-2', label: '열2', width: 150 },
    ],
    tableRowsData: [
      {
        id: 'tr1',
        label: '행1',
        cells: [
          { id: 'tcell-1', type: 'text', content: '' },
          { id: 'tcell-2', type: 'text', content: '' },
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
    questions: [brokenRadioQ, tableQ],
    lookups: [],
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

function saveButton() {
  return screen.getByRole('button', { name: '저장' });
}

function failSaveOnBrokenRadio() {
  const { rerender } = render(
    <QuestionEditModal questionId="qR" isOpen={true} onClose={() => {}} />,
  );
  fireEvent.click(saveButton());
  // radio 설명 테이블 + choice_opt 0개 → 검증 실패 배너
  expect(screen.getByText('입력 정보를 확인해주세요')).toBeTruthy();
  expect(screen.getByText(/보기 옵션.*셀이 최소 1개/)).toBeTruthy();
  return rerender;
}

describe('QuestionEditModal 검증 에러 누수/데드락', () => {
  beforeEach(() => {
    seedSurvey();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('검증 실패 후에도 저장 버튼은 눌려야 한다 (재검증 경로 확보)', () => {
    failSaveOnBrokenRadio();
    // 셀 모달 경로로 문제를 고친 경우 에러 키가 안 지워지므로,
    // 저장 클릭 → validateForm 재실행이 유일한 회복 경로다. 비활성이면 데드락.
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('다른 질문으로 전환해 열면 이전 질문의 에러 배너가 남지 않는다', () => {
    const rerender = failSaveOnBrokenRadio();
    // 닫고 → 멀쩡한 표 질문으로 재오픈 (실제 UI 흐름과 동일)
    rerender(<QuestionEditModal questionId="qR" isOpen={false} onClose={() => {}} />);
    rerender(<QuestionEditModal questionId="qT" isOpen={true} onClose={() => {}} />);

    expect(screen.queryByText('입력 정보를 확인해주세요')).toBeNull();
    expect(screen.queryByText(/보기 옵션.*셀이 최소 1개/)).toBeNull();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('같은 질문을 닫았다 다시 열어도 에러 배너는 리셋된다', () => {
    const rerender = failSaveOnBrokenRadio();
    rerender(<QuestionEditModal questionId="qR" isOpen={false} onClose={() => {}} />);
    rerender(<QuestionEditModal questionId="qR" isOpen={true} onClose={() => {}} />);

    expect(screen.queryByText('입력 정보를 확인해주세요')).toBeNull();
  });
});
