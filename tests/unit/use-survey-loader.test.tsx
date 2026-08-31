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

const { forResponseMock, attrsLookupMock, priorAnswersLookupMock } = vi.hoisted(() => ({
  forResponseMock: vi.fn(),
  attrsLookupMock: vi.fn(),
  priorAnswersLookupMock: vi.fn(),
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
      priorAnswers: {
        lookup: (...args: unknown[]) => priorAnswersLookupMock(...args),
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
import { useSurveyResponseStore } from '@/stores/survey-response-store';

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
  priorWaveLabel: null,
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
  const rendered = renderHook(
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
  return Object.assign(rendered, { setResponses });
}

describe('useSurveyLoader 토큰 재판정', () => {
  beforeEach(() => {
    forResponseMock.mockReset();
    attrsLookupMock.mockReset();
    priorAnswersLookupMock.mockReset();
    priorAnswersLookupMock.mockResolvedValue(null);
    useSurveyResponseStore.getState().resetResponseState();
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

describe('useSurveyLoader 이월 응답 적재', () => {
  beforeEach(() => {
    forResponseMock.mockReset();
    attrsLookupMock.mockReset();
    priorAnswersLookupMock.mockReset();
    useSurveyResponseStore.getState().resetResponseState();
    vi.mocked(contactAttrsService.lookupContactAttrs).mockReset();
  });

  it('이월 응답을 응답값에 깔지 않고 참조로만 들고 있는다', async () => {
    forResponseMock.mockResolvedValue(responseResult());
    attrsLookupMock.mockResolvedValue({ name: '홍길동' });
    priorAnswersLookupMock.mockResolvedValue({
      q1: '작년 답',
      __optTexts__: { q1: { o1: '작년 기타' } },
    });

    const { result, setResponses } = renderLoader({ inviteToken: INVITE_A, testToken: null });

    await waitFor(() => expect(result.current.prefillSettled).toBe(true));
    expect(priorAnswersLookupMock).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      inviteToken: INVITE_A,
    });
    // 이월 값은 responses 에 들어가지 않는다 — 응답자가 변동 확인을 밝히는 순간
    // 문항 단위로 복사된다(보지 못한 문항이 이월 값으로 제출되는 것을 막는다).
    expect(setResponses).not.toHaveBeenCalled();
    expect(result.current.priorAnswers).toEqual({
      q1: '작년 답',
      __optTexts__: { q1: { o1: '작년 기타' } },
    });
    // 기타/상세 기재는 스토어에 시드한다 — 잠긴 표시에 텍스트가 보여야 하고,
    // 미선택 옵션의 텍스트는 제출 경계에서 걸러진다.
    expect(useSurveyResponseStore.getState().optionTexts).toEqual({
      q1: { o1: '작년 기타' },
    });
  });

  it('이월 응답이 없는 대상자는 응답값을 건드리지 않는다', async () => {
    forResponseMock.mockResolvedValue(responseResult());
    attrsLookupMock.mockResolvedValue({ name: '홍길동' });
    priorAnswersLookupMock.mockResolvedValue(null);

    const { result, setResponses } = renderLoader({ inviteToken: INVITE_A, testToken: null });

    await waitFor(() => expect(result.current.prefillSettled).toBe(true));
    expect(setResponses).not.toHaveBeenCalled();
    expect(result.current.priorAnswers).toBeNull();
  });

  it('익명 응답자는 이월 응답을 조회하지 않는다', async () => {
    forResponseMock.mockResolvedValue(responseResult());

    const { result, setResponses } = renderLoader({ inviteToken: null, testToken: null });

    await waitFor(() => expect(result.current.prefillSettled).toBe(true));
    expect(priorAnswersLookupMock).not.toHaveBeenCalled();
    expect(setResponses).not.toHaveBeenCalled();
    expect(result.current.priorAnswers).toBeNull();
  });

  it('이월 응답 조회가 실패해도 설문 로딩을 막지 않는다 — 프리필만 생략', async () => {
    forResponseMock.mockResolvedValue(responseResult());
    attrsLookupMock.mockResolvedValue({ name: '홍길동' });
    priorAnswersLookupMock.mockRejectedValue(new Error('boom'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result, setResponses } = renderLoader({ inviteToken: INVITE_A, testToken: null });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadError).toBeNull();
    expect(result.current.contactAttrs).toEqual({ name: '홍길동' });
    expect(setResponses).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('무효 테스트 링크면 프리필하지 않는다', async () => {
    forResponseMock.mockResolvedValue(responseResult());
    vi.mocked(contactAttrsService.lookupContactAttrs).mockRejectedValue(
      new contactAttrsService.InvalidTestLinkError(),
    );
    const boundaryClient = attrsBoundaryClient();
    attrsLookupMock.mockImplementation((input) => boundaryClient.attrs.lookup(input));
    priorAnswersLookupMock.mockResolvedValue({ q1: '작년 답' });

    const { result, setResponses } = renderLoader({ inviteToken: INVITE_A, testToken: null });

    await waitFor(() => expect(result.current.control?.testSession).toBe('invalid'));
    expect(setResponses).not.toHaveBeenCalled();
    expect(result.current.priorAnswers).toBeNull();
  });
});
