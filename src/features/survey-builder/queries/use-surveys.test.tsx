/**
 * 설문 삭제 · 복구 · 복제 뒤의 무효화 (설문 그룹 중첩 티켓 10).
 *
 * 그룹의 건수는 **지워지지 않은** 설문을 센다(하위 그룹까지). 그룹에 담긴 설문을 지우거나 되살리면
 * 그 그룹과 위쪽 그룹의 건수가 바뀌므로 그룹 목록도 다시 읽어야 한다 — 설문 목록만 접으면 그룹 화면
 * 머리 · 폴더 줄 · 사이드바의 숫자가 낡은 채 남는다.
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { surveyGroupKeys } from '@/shared/lib/survey-group-queries';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

import { useDeleteSurvey, useDuplicateSurvey, useRestoreSurvey } from './use-surveys';

const deleteCall = vi.fn();
const restoreCall = vi.fn();
const duplicateCall = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      surveys: {
        delete: (...a: unknown[]) => deleteCall(...a),
        restore: (...a: unknown[]) => restoreCall(...a),
        duplicate: (...a: unknown[]) => duplicateCall(...a),
      },
    },
  },
  orpc: {},
}));

const TEAM = '22222222-2222-4222-8222-222222222222';
const SURVEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

/** 그룹 목록과 설문 목록이 캐시에 선 화면 — 무효화됐는지는 캐시의 표식으로 본다. */
function setup() {
  const queryClient = new QueryClient();
  const groupListKey = surveyGroupKeys.list(TEAM);
  const surveyListKey = [...surveyKeys.lists(), 'page'];
  queryClient.setQueryData(groupListKey, []);
  queryClient.setQueryData(surveyListKey, []);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const isStale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
  return {
    wrapper,
    groupsStale: () => isStale(groupListKey),
    surveysStale: () => isStale(surveyListKey),
  };
}

beforeEach(() => {
  deleteCall.mockReset().mockResolvedValue({ success: true });
  restoreCall.mockReset().mockResolvedValue({ success: true });
  duplicateCall.mockReset().mockResolvedValue({ id: 'copy' });
});

describe('설문 삭제 · 복구 — 그룹 목록도 다시 읽는다', () => {
  it('삭제하면 설문 목록과 그룹 목록이 함께 무효화된다', async () => {
    const { wrapper, groupsStale, surveysStale } = setup();
    const { result } = renderHook(() => useDeleteSurvey(), { wrapper });

    await result.current.mutateAsync(SURVEY);

    expect(deleteCall).toHaveBeenCalledWith({ surveyId: SURVEY });
    await waitFor(() => expect(surveysStale()).toBe(true));
    expect(groupsStale()).toBe(true);
  });

  it('복구하면 설문 목록과 그룹 목록이 함께 무효화된다', async () => {
    const { wrapper, groupsStale, surveysStale } = setup();
    const { result } = renderHook(() => useRestoreSurvey(), { wrapper });

    await result.current.mutateAsync(SURVEY);

    expect(restoreCall).toHaveBeenCalledWith({ surveyId: SURVEY });
    await waitFor(() => expect(surveysStale()).toBe(true));
    expect(groupsStale()).toBe(true);
  });
});

describe('설문 복제 — 그룹 목록은 그대로다', () => {
  // 사본은 원본의 그룹을 물려받지 않고 미분류로 선다(복제 서비스가 소속 그룹 칸을 옮기지 않는다) —
  // 어느 그룹의 건수도 바뀌지 않는다.
  it('복제하면 설문 목록만 무효화된다', async () => {
    const { wrapper, groupsStale, surveysStale } = setup();
    const { result } = renderHook(() => useDuplicateSurvey(), { wrapper });

    await result.current.mutateAsync(SURVEY);

    await waitFor(() => expect(surveysStale()).toBe(true));
    expect(groupsStale()).toBe(false);
  });
});
