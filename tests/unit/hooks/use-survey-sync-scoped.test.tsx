import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveDiffMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      save: { saveDiff: saveDiffMock },
    },
  },
  orpc: {},
}));

import { useSurveySync } from '@/hooks/use-survey-sync';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { Question, Survey } from '@/types/survey';

// saveSurveyScoped 회귀 테스트: 리매핑 자동 저장이 대상 질문의 updated 와 (요청 시)
// 메타데이터만 전송하고, 빌더에 대기 중인 무관한 pending(질문 추가/삭제/순서/타 질문
// 수정/메타데이터)은 changeset 에 그대로 남겨야 한다 — 전체 flush 부작용 회귀 방지.

const SURVEY_ID = 'survey-scoped';

function makeQuestion(id: string): Question {
  return { id, type: 'radio', title: id, required: false, order: 1 };
}

function makeSurvey(): Survey {
  return {
    id: SURVEY_ID,
    title: 'test',
    description: '',
    slug: '',
    privateToken: 'token',
    groups: [],
    questions: [makeQuestion('q-in'), makeQuestion('q-out'), makeQuestion('q-new')],
    lookups: [],
    settings: useSurveyBuilderStore.getState().currentSurvey.settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function seedStore() {
  useSurveyBuilderStore.getState().resetSurvey();
  useSurveyBuilderStore.getState().setSurvey(makeSurvey());
  useSurveyBuilderStore.setState({
    questionChanges: {
      updated: { 'q-in': true, 'q-out': true },
      added: { 'q-new': true },
      deleted: { 'q-deleted': true },
      reordered: true,
    },
    isMetadataDirty: true,
    isDirty: true,
  });
}

describe('useSurveySync.saveSurveyScoped', () => {
  beforeEach(() => {
    saveDiffMock.mockReset();
    seedStore();
  });

  it('스코프 질문의 updated 만 전송하고 무관한 pending 은 changeset 에 남긴다', async () => {
    saveDiffMock.mockResolvedValue({ surveyId: SURVEY_ID });
    const { result } = renderHook(() => useSurveySync(), { wrapper });

    await act(async () => {
      await result.current.saveSurveyScoped({ questionIds: ['q-in'], includeMetadata: false });
    });

    expect(saveDiffMock).toHaveBeenCalledTimes(1);
    const payload = saveDiffMock.mock.calls[0]![0];
    expect(payload.questionChanges.upserted.map((q: Question) => q.id)).toEqual(['q-in']);
    expect(payload.questionChanges.deleted).toEqual([]);
    expect(payload.questionChanges.reorderedIds).toBeUndefined();
    expect(payload.metadata).toBeUndefined();

    // out-of-scope 는 그대로 pending
    const state = useSurveyBuilderStore.getState();
    expect(state.questionChanges.updated['q-out']).toBe(true);
    expect(state.questionChanges.updated['q-in']).toBeUndefined();
    expect(state.questionChanges.added['q-new']).toBe(true);
    expect(state.questionChanges.deleted['q-deleted']).toBe(true);
    expect(state.questionChanges.reordered).toBe(true);
    expect(state.isMetadataDirty).toBe(true);
    expect(state.isDirty).toBe(true);
  });

  it('includeMetadata=true 면 메타데이터를 함께 전송하고 메타 dirty 를 소거한다', async () => {
    saveDiffMock.mockResolvedValue({ surveyId: SURVEY_ID });
    const { result } = renderHook(() => useSurveySync(), { wrapper });

    await act(async () => {
      await result.current.saveSurveyScoped({ questionIds: ['q-in'], includeMetadata: true });
    });

    const payload = saveDiffMock.mock.calls[0]![0];
    expect(payload.metadata).toBeDefined();
    expect(useSurveyBuilderStore.getState().isMetadataDirty).toBe(false);
  });

  it('저장 실패 시 스코프 변경을 changeset 에 되돌리고 throw 한다', async () => {
    saveDiffMock.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useSurveySync(), { wrapper });

    await expect(
      act(async () => {
        await result.current.saveSurveyScoped({ questionIds: ['q-in'], includeMetadata: false });
      }),
    ).rejects.toThrow('network');

    const state = useSurveyBuilderStore.getState();
    expect(state.questionChanges.updated['q-in']).toBe(true);
    expect(state.questionChanges.updated['q-out']).toBe(true);
    expect(state.isDirty).toBe(true);
  });
});
