import type { ReactElement } from 'react';

import type { DehydratedState } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkScopeError } from '@/server/work-scope';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

import SurveyListPage from './page';

const getSurveyListWithCounts = vi.fn();
const cookieValue = vi.fn<() => string | undefined>();
const warn = vi.fn();

vi.mock('@/lib/auth/require-admin-page', () => ({
  requireAdminPage: async () => ({ id: 'user-1', isSuperadmin: true }),
}));
vi.mock('@/server/survey-builder/services/survey-read', () => ({
  getSurveyListWithCounts: (...args: unknown[]) => getSurveyListWithCounts(...args),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => {
      const value = cookieValue();
      return value === undefined ? undefined : { value };
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: (...args: unknown[]) => warn(...args) } }));
vi.mock('@/features/survey-builder/survey-list/survey-list-view', () => ({
  SurveyListView: () => null,
}));

/** 페이지가 화면에 넘기는 쿼리 캐시 — HydrationBoundary 의 state. */
async function renderedCache(): Promise<DehydratedState> {
  const element = (await SurveyListPage()) as ReactElement<{ state: DehydratedState }>;
  return element.props.state;
}

function listResult(scope: unknown) {
  return { scope, teams: [], canSeeSystemScope: true, deletedCount: 0, surveys: [] };
}

describe('설문 목록 페이지 — 첫 목록 미리 받기', () => {
  beforeEach(() => {
    getSurveyListWithCounts.mockReset();
    cookieValue.mockReset();
    warn.mockReset();
  });

  it('서버가 해석한 범위의 키로 목록을 넘긴다 — 화면이 같은 키로 조회해 왕복하지 않는다', async () => {
    cookieValue.mockReturnValue('team-1');
    const result = listResult({ kind: 'team', teamId: 'team-1' });
    getSurveyListWithCounts.mockResolvedValue(result);

    const cache = await renderedCache();

    expect(getSurveyListWithCounts).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'team-1',
    );
    expect(cache.queries).toHaveLength(1);
    expect(cache.queries[0]?.queryKey).toEqual(surveyKeys.list('team-1'));
    expect(cache.queries[0]?.state.data).toBe(result);
  });

  it('시스템 전체 보기는 예약어 키로 넘긴다', async () => {
    getSurveyListWithCounts.mockResolvedValue(listResult({ kind: 'system' }));

    const cache = await renderedCache();

    expect(cache.queries[0]?.queryKey).toEqual(surveyKeys.list('system'));
  });

  it('쿠키의 범위가 무효면 셸처럼 기본 범위로 다시 받는다', async () => {
    cookieValue.mockReturnValue('system');
    getSurveyListWithCounts
      .mockRejectedValueOnce(new WorkScopeError('forbidden'))
      .mockResolvedValueOnce(listResult({ kind: 'team', teamId: 'team-2' }));

    const cache = await renderedCache();

    expect(getSurveyListWithCounts).toHaveBeenLastCalledWith(expect.anything(), null);
    expect(cache.queries[0]?.queryKey).toEqual(surveyKeys.list('team-2'));
  });

  it('미리 받기가 실패해도 페이지를 막지 않는다 — 캐시가 비어 화면이 종전대로 조회한다', async () => {
    getSurveyListWithCounts.mockRejectedValue(new Error('db down'));

    const cache = await renderedCache();

    expect(cache.queries).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
