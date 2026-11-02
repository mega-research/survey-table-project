import type { ReactElement } from 'react';

import type { DehydratedState } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkScopeError } from '@/server/work-scope';
import { INITIAL_SURVEY_LIST_PAGE_QUERY } from '@/shared/contracts/survey-builder-io';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

import SurveyListPage from './page';

const listSurveyPage = vi.fn();
const cookieValue = vi.fn<() => string | undefined>();
const warn = vi.fn();

vi.mock('@/lib/auth/require-admin-page', () => ({
  requireAdminPage: async () => ({ id: 'user-1', isSuperadmin: true }),
}));
vi.mock('@/server/survey-builder/services/survey-read', () => ({
  listSurveyPage: (...args: unknown[]) => listSurveyPage(...args),
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
async function renderedCache(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<DehydratedState> {
  const element = (await SurveyListPage({
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement<{ state: DehydratedState }>;
  return element.props.state;
}

function listResult(scope: unknown) {
  return { scope, teams: [], canSeeSystemScope: true, deletedCount: 0, items: [], total: 0 };
}

const Q = INITIAL_SURVEY_LIST_PAGE_QUERY;

describe('설문 목록 페이지 — 첫 목록 미리 받기', () => {
  beforeEach(() => {
    listSurveyPage.mockReset();
    cookieValue.mockReset();
    warn.mockReset();
  });

  it('서버가 해석한 범위의 키로 목록을 넘긴다 — 화면이 같은 키로 조회해 왕복하지 않는다', async () => {
    cookieValue.mockReturnValue('team-1');
    const result = listResult({ kind: 'team', teamId: 'team-1' });
    listSurveyPage.mockResolvedValue(result);

    const cache = await renderedCache();

    expect(listSurveyPage).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), {
      ...Q,
      scope: 'team-1',
    });
    expect(cache.queries).toHaveLength(1);
    expect(cache.queries[0]?.queryKey).toEqual(surveyKeys.page('team-1', Q));
    expect(cache.queries[0]?.state.data).toBe(result);
  });

  it('시스템 전체 보기는 예약어 키로 넘긴다', async () => {
    listSurveyPage.mockResolvedValue(listResult({ kind: 'system' }));

    const cache = await renderedCache();

    expect(cache.queries[0]?.queryKey).toEqual(surveyKeys.page('system', Q));
  });

  it('쿠키의 범위가 무효면 셸처럼 기본 범위로 다시 받는다', async () => {
    cookieValue.mockReturnValue('system');
    listSurveyPage
      .mockRejectedValueOnce(new WorkScopeError('forbidden'))
      .mockResolvedValueOnce(listResult({ kind: 'team', teamId: 'team-2' }));

    const cache = await renderedCache();

    expect(listSurveyPage).toHaveBeenLastCalledWith(expect.anything(), { ...Q, scope: null });
    expect(cache.queries[0]?.queryKey).toEqual(surveyKeys.page('team-2', Q));
  });

  it('주소의 조건으로 첫 페이지를 받고 화면과 같은 키로 넘긴다', async () => {
    cookieValue.mockReturnValue('team-1');
    listSurveyPage.mockResolvedValue(listResult({ kind: 'team', teamId: 'team-1' }));
    const cache = await renderedCache({
      q: '실태',
      status: 'closed',
      page: '2',
      sort: ['title', 'x'],
    });

    const query = {
      ...Q,
      q: '실태',
      lifecycle: 'closed' as const,
      page: 2,
      sort: 'title' as const,
    };
    expect(listSurveyPage).toHaveBeenCalledWith(expect.anything(), { ...query, scope: 'team-1' });
    expect(cache.queries[0]?.queryKey).toEqual(surveyKeys.page('team-1', query));
  });

  it('여러 번 온 검색 칩(tag)은 모두 순서대로 조건에 담는다', async () => {
    cookieValue.mockReturnValue('team-1');
    listSurveyPage.mockResolvedValue(listResult({ kind: 'team', teamId: 'team-1' }));
    const tagA = '44444444-5555-4666-8777-888888888888';
    const tagB = '55555555-6666-4777-8888-999999999999';
    const cache = await renderedCache({ tag: [tagA, tagB] });

    const query = { ...Q, tagIds: [tagA, tagB] };
    expect(listSurveyPage).toHaveBeenCalledWith(expect.anything(), { ...query, scope: 'team-1' });
    expect(cache.queries[0]?.queryKey).toEqual(surveyKeys.page('team-1', query));
  });

  it('미리 받기가 실패해도 페이지를 막지 않는다 — 캐시가 비어 화면이 종전대로 조회한다', async () => {
    listSurveyPage.mockRejectedValue(new Error('db down'));

    const cache = await renderedCache();

    expect(cache.queries).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
