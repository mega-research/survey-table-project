import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { type RouterClient } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import type {
  SurveyControl,
  SurveyForResponseResult,
} from '@/features/survey-builder/domain/survey-read';
import type { Survey } from '@/types/survey';

const { forResponseMock, attrsLookupMock } = vi.hoisted(() => ({
  forResponseMock: vi.fn(),
  attrsLookupMock: vi.fn(),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyBuilder: {
      publicRead: {
        bySlug: vi.fn(),
        byPrivateToken: vi.fn(),
        forResponse: (...args: unknown[]) => forResponseMock(...args),
      },
    },
    contacts: {
      attrs: {
        lookup: (...args: unknown[]) => attrsLookupMock(...args),
      },
    },
  },
}));

vi.mock('@/features/contacts/server/services/contact-attrs.service', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/features/contacts/server/services/contact-attrs.service')
  >();
  return { ...actual, lookupContactAttrs: vi.fn() };
});

import * as contactAttrsService from '@/features/contacts/server/services/contact-attrs.service';
import { attrs } from '@/features/contacts/server/procedures/attrs';
import { useSurveyLoader } from '@/components/survey-response/hooks/use-survey-loader';

const SURVEY_ID = 'survey-loader-test';
const INVITE_A = '11111111-2222-4333-8444-555555555555';
const INVITE_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const survey: Survey = {
  id: SURVEY_ID,
  title: '로더 테스트 설문',
  description: '토큰 변경 재판정 테스트',
  status: 'published',
  currentVersionId: null,
  groups: [],
  questions: [],
  settings: {
    isPublic: true,
    allowMultipleResponses: false,
    showProgressBar: true,
    shuffleQuestions: false,
    requireLogin: false,
    thankYouMessage: '감사합니다.',
    requireInviteToken: false,
  },
  lookups: [],
  createdAt: new Date('2026-07-22T00:00:00.000Z'),
  updatedAt: new Date('2026-07-22T00:00:00.000Z'),
};

const noneControl: SurveyControl = {
  isPaused: false,
  pausedMessage: null,
  testSession: 'none',
  testSessionKind: null,
};

function responseResult(control: SurveyControl = noneControl): NonNullable<SurveyForResponseResult> {
  return { survey, versionId: null, control };
}

function anonContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: {} as never,
    user: null,
    headers: new Headers({ 'x-real-ip': '203.0.113.9' }),
  };
}

function attrsBoundaryClient(): RouterClient<{ attrs: typeof attrs }> {
  const handler = new RPCHandler({ attrs });
  const link = new RPCLink({
    url: 'http://localhost/api/rpc',
    fetch: async (request) => {
      const { response } = await handler.handle(request, {
        prefix: '/api/rpc',
        context: anonContext(),
      });
      if (!response) throw new Error('RPC 응답이 없습니다.');
      return response;
    },
  });
  return createORPCClient(link);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderLoader(initialProps: { inviteToken: string | null; testToken: string | null }) {
  const setResponses = vi.fn();
  return renderHook(
    (props: typeof initialProps) =>
      useSurveyLoader({
        identifier: SURVEY_ID,
        isAdminEdit: false,
        adminContext: undefined,
        inviteToken: props.inviteToken,
        testToken: props.testToken,
        setResponses,
      }),
    { initialProps },
  );
}

describe('useSurveyLoader 토큰 재판정', () => {
  beforeEach(() => {
    forResponseMock.mockReset();
    attrsLookupMock.mockReset();
    vi.mocked(contactAttrsService.lookupContactAttrs).mockReset();
  });

  it('RPC 경계를 통과한 INVALID_TEST_LINK를 loader 종료 상태로 반영한다', async () => {
    forResponseMock.mockResolvedValue(responseResult());
    vi.mocked(contactAttrsService.lookupContactAttrs).mockRejectedValue(
      new contactAttrsService.InvalidTestLinkError(),
    );
    const boundaryClient = attrsBoundaryClient();
    attrsLookupMock.mockImplementation((input) => boundaryClient.attrs.lookup(input));

    const { result } = renderLoader({ inviteToken: INVITE_A, testToken: null });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadError).toBeNull();
    expect(result.current.loadedSurvey?.id).toBe(SURVEY_ID);
    expect(result.current.control).toEqual({
      ...noneControl,
      testSession: 'invalid',
    });
  });

  it('같은 설문에서 inviteToken이 바뀌면 이전 attrs/control을 초기화하고 재판정한다', async () => {
    const nextResponse = deferred<NonNullable<SurveyForResponseResult>>();
    forResponseMock
      .mockResolvedValueOnce(
        responseResult({
          ...noneControl,
          testSession: 'valid',
          testSessionKind: 'target',
        }),
      )
      .mockImplementationOnce(() => nextResponse.promise);
    attrsLookupMock.mockResolvedValueOnce({ name: '첫 대상자' }).mockResolvedValueOnce(null);

    const { result, rerender } = renderLoader({ inviteToken: INVITE_A, testToken: null });
    await waitFor(() => expect(result.current.contactAttrs).toEqual({ name: '첫 대상자' }));
    expect(result.current.control?.testSessionKind).toBe('target');

    rerender({ inviteToken: INVITE_B, testToken: null });

    await waitFor(() => {
      expect(forResponseMock).toHaveBeenLastCalledWith({
        surveyId: SURVEY_ID,
        inviteToken: INVITE_B,
      });
    });
    expect(result.current.contactAttrs).toEqual({});
    expect(result.current.control).toBeNull();

    await act(async () => {
      nextResponse.resolve(
        responseResult({ ...noneControl, testSession: 'invalid' }),
      );
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.control?.testSession).toBe('invalid');
  });

  it('같은 설문에서 testToken이 바뀌면 public control을 재판정한다', async () => {
    forResponseMock
      .mockResolvedValueOnce(
        responseResult({
          ...noneControl,
          testSession: 'valid',
          testSessionKind: 'anonymous',
        }),
      )
      .mockResolvedValueOnce(responseResult({ ...noneControl, testSession: 'invalid' }));

    const { result, rerender } = renderLoader({ inviteToken: null, testToken: 'test-a' });
    await waitFor(() => expect(result.current.control?.testSession).toBe('valid'));

    rerender({ inviteToken: null, testToken: 'test-b' });

    await waitFor(() => expect(result.current.control?.testSession).toBe('invalid'));
    expect(forResponseMock).toHaveBeenNthCalledWith(2, {
      surveyId: SURVEY_ID,
      testToken: 'test-b',
    });
  });

  it('이전 토큰 조회가 늦게 완료돼도 최신 control을 덮어쓰지 않는다', async () => {
    const staleResponse = deferred<NonNullable<SurveyForResponseResult>>();
    forResponseMock
      .mockImplementationOnce(() => staleResponse.promise)
      .mockResolvedValueOnce(responseResult({ ...noneControl, testSession: 'invalid' }));

    const { result, rerender } = renderLoader({ inviteToken: null, testToken: 'old-token' });
    await waitFor(() => expect(forResponseMock).toHaveBeenCalledTimes(1));

    rerender({ inviteToken: null, testToken: 'new-token' });
    await waitFor(() => expect(result.current.control?.testSession).toBe('invalid'));

    await act(async () => {
      staleResponse.resolve(
        responseResult({
          ...noneControl,
          testSession: 'valid',
          testSessionKind: 'anonymous',
        }),
      );
    });

    expect(result.current.control?.testSession).toBe('invalid');
    expect(forResponseMock).toHaveBeenCalledTimes(2);
  });
});
