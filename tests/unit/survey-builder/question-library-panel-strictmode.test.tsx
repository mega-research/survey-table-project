import { StrictMode } from 'react';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * StrictMode 이중 마운트에서 mountedRef 가 false 로 굳는 회귀 테스트.
 *
 * `const mountedRef = useRef(true); useEffect(() => () => { mountedRef.current = false; }, [])`
 * 패턴은 StrictMode(dev 기본)의 mount→cleanup→mount 시뮬레이션에서 cleanup 만 실행되고
 * 본문이 true 를 복원하지 않아, 마운트된 컴포넌트의 mountedRef 가 영원히 false 가 된다.
 * 그 결과 보관함 질문 추가가 apply 200 을 받고도 결과를 버리고 스피너("추가 중")가
 * 고착됐다 (2026-08-20 실사고, 프로덕션 빌드는 StrictMode 가 없어 정상이라 dev 에서만 재현).
 */

const applyMutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/queries/use-library', () => {
  const queryResult = (data: unknown) => ({ data, isLoading: false });
  const mutationResult = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  });
  return {
    useApplyMultipleQuestions: () => ({ ...mutationResult() }),
    useApplyQuestion: () => ({ mutate: vi.fn(), mutateAsync: applyMutateAsync, isPending: false }),
    useCategories: () => queryResult([{ id: 'custom', name: '일반', icon: 'Folder', color: '', order: 0 }]),
    useDeleteSavedQuestion: () => mutationResult(),
    useInitializeCategories: () => mutationResult(),
    useInitializePresets: () => mutationResult(),
    useMostUsedQuestions: () => queryResult([]),
    useRecentlyUsedQuestions: () => queryResult([]),
    useSavedQuestions: () => queryResult([SAVED_QUESTION]),
    useSearchQuestions: () => queryResult([]),
  };
});

vi.mock('@/components/survey-builder/lookup-library-section', () => ({
  LookupLibrarySection: () => null,
}));

import { QuestionLibraryPanel } from '@/components/survey-builder/question-library-panel';
import { useSurveyBuilderStore } from '@/stores/survey-store';

const SAVED_QUESTION = {
  id: 'saved-1',
  name: '보관 질문',
  description: '',
  tags: [],
  category: 'custom',
  usageCount: 0,
  isPreset: false,
  question: {
    id: 'q-src',
    type: 'text',
    title: '보관된 단답',
    required: false,
    order: 0,
  },
  createdAt: new Date('2026-08-20T00:00:00.000Z'),
  updatedAt: new Date('2026-08-20T00:00:00.000Z'),
};

describe('QuestionLibraryPanel — StrictMode 이중 마운트', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    applyMutateAsync.mockReset();
    applyMutateAsync.mockResolvedValue({ ...SAVED_QUESTION.question });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('추가 버튼이 apply 성공 후 질문을 스토어에 넣고 스피너를 해제한다', async () => {
    const { container } = render(
      <StrictMode>
        <QuestionLibraryPanel />
      </StrictMode>,
    );

    // 카테고리 섹션 펼치기
    const sectionToggle = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('일반'),
    );
    if (!sectionToggle) throw new Error('카테고리 섹션을 찾지 못했습니다');
    fireEvent.click(sectionToggle);

    // 항목 행의 추가(+) 버튼 — 아이콘 전용이라 클래스(text-blue-600)로 특정한다
    const addButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.className.includes('text-blue-600'),
    );
    if (!addButton) throw new Error('추가 버튼을 찾지 못했습니다');
    fireEvent.click(addButton);

    await waitFor(() => expect(applyMutateAsync).toHaveBeenCalledWith('saved-1'));
    // 핵심: mountedRef 가 살아 있어야 스토어 반영 + 스피너 해제가 일어난다
    await waitFor(() => {
      const questions = useSurveyBuilderStore.getState().currentSurvey.questions;
      expect(questions.some((q) => q.title === '보관된 단답')).toBe(true);
    });
  });
});
