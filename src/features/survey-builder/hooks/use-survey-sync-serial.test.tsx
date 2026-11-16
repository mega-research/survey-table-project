import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveDiffMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      save: { saveDiff: saveDiffMock },
    },
  },
  orpc: {},
}));

import { useSurveySync } from '@/features/survey-builder/hooks/use-survey-sync';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import type { Question, Survey } from '@/types/survey';

// 저장 중에 다시 저장을 부르면 「이미 저장 중」이라며 null 을 돌려주던 회귀 테스트.
// 호출부는 null 을 성공으로 읽어 저장 완료 창을 띄우고, 배포는 저장 없이 진행했다 —
// 그 사이 바뀐 내용이 저장되지 않은 채 「저장됨」으로 보였다.

const SURVEY_ID = 'survey-serial';

function makeQuestion(id: string): Question {
  return { id, type: 'radio', title: id, required: false, order: 1 };
}

function makeSurvey(id: string = SURVEY_ID): Survey {
  return {
    id,
    title: 'test',
    description: '',
    slug: '',
    privateToken: 'token',
    groups: [],
    questions: [makeQuestion('q-first'), makeQuestion('q-second')],
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

function markUpdated(questionId: string) {
  useSurveyBuilderStore.setState((state) => ({
    questionChanges: {
      ...state.questionChanges,
      updated: { ...state.questionChanges.updated, [questionId]: true },
    },
    isDirty: true,
  }));
}

/** 손으로 끝내는 saveDiff 응답 하나 */
function deferredSave() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ surveyId: string }>((res, rej) => {
    resolve = () => res({ surveyId: SURVEY_ID });
    reject = rej;
  });
  return { promise, resolve, reject };
}

function upsertedIds(callIndex: number): string[] {
  const payload = saveDiffMock.mock.calls[callIndex]![0];
  return payload.questionChanges.upserted.map((q: Question) => q.id);
}

describe('useSurveySync — 저장은 한 줄로 선다', () => {
  beforeEach(() => {
    saveDiffMock.mockReset();
    useSurveyBuilderStore.getState().resetSurvey();
    useSurveyBuilderStore.getState().setSurvey(makeSurvey());
    markUpdated('q-first');
  });

  it('저장 중에 다시 저장하면 건너뛰지 않고, 앞 저장이 끝난 뒤 그 사이 바뀐 내용을 저장한다', async () => {
    const first = deferredSave();
    saveDiffMock.mockReturnValueOnce(first.promise).mockResolvedValue({ surveyId: SURVEY_ID });
    const { result } = renderHook(() => useSurveySync(), { wrapper });

    let firstSave!: Promise<unknown>;
    let secondSave!: Promise<unknown>;
    let secondSettled = false;
    await act(async () => {
      firstSave = result.current.saveSurvey();
      await Promise.resolve();
      // 첫 저장이 서버에 가 있는 동안 다른 문항을 고치고 저장을 또 누른다
      markUpdated('q-second');
      secondSave = result.current.saveSurvey().then((value) => {
        secondSettled = true;
        return value;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 앞 저장이 끝나기 전에는 뒤 저장이 「끝났다」고 답하지 않는다
    expect(saveDiffMock).toHaveBeenCalledTimes(1);
    expect(secondSettled).toBe(false);

    await act(async () => {
      first.resolve();
      await firstSave;
      await secondSave;
    });

    expect(saveDiffMock).toHaveBeenCalledTimes(2);
    expect(upsertedIds(0)).toEqual(['q-first']);
    expect(upsertedIds(1)).toEqual(['q-second']);
    await expect(secondSave).resolves.toEqual({ surveyId: SURVEY_ID });
    expect(useSurveyBuilderStore.getState().isDirty).toBe(false);
  });

  it('훅을 따로 쓰는 화면끼리도 같은 줄에 선다 (편집 화면 저장 · 조사표 패널 저장)', async () => {
    const first = deferredSave();
    saveDiffMock.mockReturnValueOnce(first.promise).mockResolvedValue({ surveyId: SURVEY_ID });
    const page = renderHook(() => useSurveySync(), { wrapper });
    const panel = renderHook(() => useSurveySync(), { wrapper });

    let firstSave!: Promise<unknown>;
    let secondSave!: Promise<unknown>;
    await act(async () => {
      firstSave = page.result.current.saveSurvey();
      await Promise.resolve();
      markUpdated('q-second');
      secondSave = panel.result.current.saveSurvey();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(saveDiffMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
      await firstSave;
      await secondSave;
    });
    expect(saveDiffMock).toHaveBeenCalledTimes(2);
    expect(upsertedIds(1)).toEqual(['q-second']);
  });

  it('앞 저장이 실패하면 뒤 저장이 되돌려진 변경까지 함께 저장한다', async () => {
    const first = deferredSave();
    saveDiffMock.mockReturnValueOnce(first.promise).mockResolvedValue({ surveyId: SURVEY_ID });
    const { result } = renderHook(() => useSurveySync(), { wrapper });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    let firstSave!: Promise<unknown>;
    let secondSave!: Promise<unknown>;
    await act(async () => {
      firstSave = result.current.saveSurvey();
      firstSave.catch(() => undefined);
      await Promise.resolve();
      markUpdated('q-second');
      secondSave = result.current.saveSurvey();
      await new Promise((resolve) => setTimeout(resolve, 0));
      first.reject(new Error('network'));
      await firstSave.catch(() => undefined);
      await secondSave;
    });

    await expect(firstSave).rejects.toThrow('network');
    expect(saveDiffMock).toHaveBeenCalledTimes(2);
    expect(upsertedIds(1).sort()).toEqual(['q-first', 'q-second']);
    expect(useSurveyBuilderStore.getState().isDirty).toBe(false);
  });

  it('스코프 저장도 진행 중인 저장을 기다렸다가 자기 범위를 저장한다', async () => {
    const first = deferredSave();
    saveDiffMock.mockReturnValueOnce(first.promise).mockResolvedValue({ surveyId: SURVEY_ID });
    const { result } = renderHook(() => useSurveySync(), { wrapper });

    let firstSave!: Promise<unknown>;
    let scopedSave!: Promise<unknown>;
    await act(async () => {
      firstSave = result.current.saveSurvey();
      await Promise.resolve();
      markUpdated('q-second');
      scopedSave = result.current.saveSurveyScoped({ questionIds: ['q-second'] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(saveDiffMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
      await firstSave;
      await scopedSave;
    });
    expect(saveDiffMock).toHaveBeenCalledTimes(2);
    expect(upsertedIds(1)).toEqual(['q-second']);
    await expect(scopedSave).resolves.toEqual({ surveyId: SURVEY_ID });
  });

  it('기다리는 사이 화면이 다른 설문으로 바뀌면 그 설문을 저장하지 않고 거부한다', async () => {
    const first = deferredSave();
    saveDiffMock.mockReturnValueOnce(first.promise).mockResolvedValue({ surveyId: SURVEY_ID });
    const { result } = renderHook(() => useSurveySync(), { wrapper });

    let firstSave!: Promise<unknown>;
    let secondSave!: Promise<unknown>;
    await act(async () => {
      firstSave = result.current.saveSurvey();
      await Promise.resolve();
      markUpdated('q-second');
      secondSave = result.current.saveSurvey();
      secondSave.catch(() => undefined);
      // 첫 저장이 서버에 가 있는 동안 다른 설문을 열어 고친다 — 아직 저장을 누르지 않았다
      useSurveyBuilderStore.getState().setSurvey(makeSurvey('survey-other'));
      markUpdated('q-first');
      first.resolve();
      await firstSave;
      await secondSave.catch(() => undefined);
    });

    await expect(secondSave).rejects.toThrow('다른 설문');
    // 다른 설문의 변경은 서버로 가지 않았고 changeset 도 그대로다
    expect(saveDiffMock).toHaveBeenCalledTimes(1);
    const state = useSurveyBuilderStore.getState();
    expect(state.currentSurvey.id).toBe('survey-other');
    expect(state.questionChanges.updated).toEqual({ 'q-first': true });
    expect(state.isDirty).toBe(true);
  });

  it('저장이 서버에 가 있는 동안 설문이 바뀌면, 끝나든 실패하든 새 설문의 changeset 을 건드리지 않는다', async () => {
    const first = deferredSave();
    const second = deferredSave();
    saveDiffMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSurveySync(), { wrapper });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // 성공으로 끝나는 경우 — 새 설문의 미저장 표시를 지우지 않는다
    let save!: Promise<unknown>;
    await act(async () => {
      save = result.current.saveSurvey();
      await Promise.resolve();
      useSurveyBuilderStore.getState().setSurvey(makeSurvey('survey-other'));
      markUpdated('q-second');
      first.resolve();
      await save;
    });
    expect(useSurveyBuilderStore.getState().isDirty).toBe(true);
    expect(useSurveyBuilderStore.getState().questionChanges.updated).toEqual({ 'q-second': true });

    // 실패로 끝나는 경우 — 옛 설문의 변경을 새 설문의 changeset 에 되돌려 넣지 않는다
    await act(async () => {
      useSurveyBuilderStore.getState().setSurvey(makeSurvey());
      markUpdated('q-first');
      save = result.current.saveSurvey();
      save.catch(() => undefined);
      await Promise.resolve();
      useSurveyBuilderStore.getState().setSurvey(makeSurvey('survey-other'));
      markUpdated('q-second');
      second.reject(new Error('network'));
      await save.catch(() => undefined);
    });
    await expect(save).rejects.toThrow('network');
    expect(useSurveyBuilderStore.getState().questionChanges.updated).toEqual({ 'q-second': true });
  });

  describe('응답 없는 저장', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('기한이 지나면 실패로 끝내고 변경을 되돌려, 다음 저장이 이어서 저장한다', async () => {
      // 끝나지 않는 요청 — 전에는 이것 하나가 뒤따르는 저장을 전부 세워 뒀다
      saveDiffMock
        .mockReturnValueOnce(new Promise(() => undefined))
        .mockResolvedValue({ surveyId: SURVEY_ID });
      const { result } = renderHook(() => useSurveySync(), { wrapper });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      let hung!: Promise<unknown>;
      let next!: Promise<unknown>;
      await act(async () => {
        hung = result.current.saveSurvey();
        hung.catch(() => undefined);
        await Promise.resolve();
        markUpdated('q-second');
        next = result.current.saveSurvey();
        await vi.advanceTimersByTimeAsync(60_000);
        await hung.catch(() => undefined);
        await next;
      });

      await expect(hung).rejects.toThrow('응답하지 않아');
      expect(saveDiffMock).toHaveBeenCalledTimes(2);
      // 끊긴 저장의 변경이 되돌려져 다음 저장에 함께 실린다
      expect(upsertedIds(1).sort()).toEqual(['q-first', 'q-second']);
      // 끊긴 요청에는 중단 신호가 갔다
      const signal = saveDiffMock.mock.calls[0]![1].signal as AbortSignal;
      expect(signal.aborted).toBe(true);
      expect(useSurveyBuilderStore.getState().isDirty).toBe(false);
    });
  });
});
