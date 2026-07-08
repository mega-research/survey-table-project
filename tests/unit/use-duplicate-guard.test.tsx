import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handlePausedMutationError,
  useDuplicateGuard,
} from '@/components/survey-response/hooks/use-duplicate-guard';
import type { ClientSignals } from '@/lib/duplicate-detection/types';
import type { Survey } from '@/types/survey';

// RPC client 모킹 — 진입 시 중복검사(duplicate.checkOnEntry) +
// 중단 감지 헬퍼의 control 재조회(surveyBuilder.publicRead.forResponse).
const checkOnEntry = vi.fn();
const forResponse = vi.fn();

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyResponse: {
      duplicate: {
        checkOnEntry: (...args: unknown[]) => checkOnEntry(...args),
      },
    },
    surveyBuilder: {
      publicRead: {
        forResponse: (...args: unknown[]) => forResponse(...args),
      },
    },
  },
}));

const survey = { id: 'survey-1', title: 't' } as unknown as Survey;

const signals: ClientSignals = {
  deviceId: 'dev-1',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

// 훅 인자 기본값. 각 테스트가 필요한 필드만 override 한다.
function baseArgs(over: Partial<Parameters<typeof useDuplicateGuard>[0]> = {}) {
  return {
    isAdminEdit: false,
    loadedSurvey: survey,
    inviteToken: null as string | null,
    signals: null as ClientSignals | null,
    ...over,
  } satisfies Parameters<typeof useDuplicateGuard>[0];
}

describe('useDuplicateGuard - 초기값', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('public 모드면 checking 으로 시작한다', () => {
    const { result } = renderHook(() => useDuplicateGuard(baseArgs()));
    expect(result.current.duplicateStatus).toEqual({ kind: 'checking' });
  });

  it('admin-edit 모드면 ok 로 시작한다 (분기 8/8)', () => {
    const { result } = renderHook(() =>
      useDuplicateGuard(baseArgs({ isAdminEdit: true })),
    );
    expect(result.current.duplicateStatus).toEqual({ kind: 'ok' });
  });

  it('preview 모드면 ok 로 시작한다', () => {
    const { result } = renderHook(() =>
      useDuplicateGuard(baseArgs({ isPreview: true })),
    );
    expect(result.current.duplicateStatus).toEqual({ kind: 'ok' });
  });

  it('skip(유효 테스트 세션) 이면 ok 로 시작한다', () => {
    const { result } = renderHook(() =>
      useDuplicateGuard(baseArgs({ skip: true })),
    );
    expect(result.current.duplicateStatus).toEqual({ kind: 'ok' });
  });
});

describe('useDuplicateGuard - checkOnEntry effect', () => {
  beforeEach(() => {
    checkOnEntry.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('signals 가 null 이면 effect 를 skip 하고 checking 을 유지한다', () => {
    const { result } = renderHook(() =>
      useDuplicateGuard(baseArgs({ signals: null })),
    );
    expect(checkOnEntry).not.toHaveBeenCalled();
    expect(result.current.duplicateStatus).toEqual({ kind: 'checking' });
  });

  it('loadedSurvey 가 null 이면 effect 를 skip 하고 checking 을 유지한다', () => {
    const { result } = renderHook(() =>
      useDuplicateGuard(baseArgs({ loadedSurvey: null, signals })),
    );
    expect(checkOnEntry).not.toHaveBeenCalled();
    expect(result.current.duplicateStatus).toEqual({ kind: 'checking' });
  });

  it('admin-edit 모드면 signals 가 있어도 effect 를 skip 한다 (분기 2/8)', () => {
    const { result } = renderHook(() =>
      useDuplicateGuard(baseArgs({ isAdminEdit: true, signals })),
    );
    expect(checkOnEntry).not.toHaveBeenCalled();
    expect(result.current.duplicateStatus).toEqual({ kind: 'ok' });
  });

  it('preview 모드면 signals 가 있어도 effect 를 skip 한다', () => {
    const { result } = renderHook(() =>
      useDuplicateGuard(baseArgs({ isPreview: true, signals })),
    );
    expect(checkOnEntry).not.toHaveBeenCalled();
    expect(result.current.duplicateStatus).toEqual({ kind: 'ok' });
  });

  it('skip 이면 signals/survey 가 있어도 checkOnEntry 없이 ok 로 통과한다', () => {
    const { result } = renderHook(() =>
      useDuplicateGuard(baseArgs({ skip: true, signals })),
    );
    expect(checkOnEntry).not.toHaveBeenCalled();
    expect(result.current.duplicateStatus).toEqual({ kind: 'ok' });
  });

  it('control 로드로 skip 이 false→true 로 바뀌면 checkOnEntry 결과와 무관하게 ok 로 맞춘다', async () => {
    checkOnEntry.mockResolvedValue({ blocked: true, reason: 'device_already_responded' });
    const { result, rerender } = renderHook((props) => useDuplicateGuard(props), {
      initialProps: baseArgs({ signals, skip: false }),
    });

    // skip 전환 — 이후 상태는 ok 여야 하고, 이미 발사된 검사 결과(blocked)로 되돌아가지 않는다.
    rerender(baseArgs({ signals, skip: true }));

    await waitFor(() =>
      expect(result.current.duplicateStatus).toEqual({ kind: 'ok' }),
    );
  });

  it('signals 가 채워지면 checkOnEntry 를 호출하고 ok 로 전이한다', async () => {
    checkOnEntry.mockResolvedValue({ blocked: false });
    const { result, rerender } = renderHook((props) => useDuplicateGuard(props), {
      initialProps: baseArgs({ signals: null }),
    });

    // signals null 동안은 미발사
    expect(checkOnEntry).not.toHaveBeenCalled();

    // signals 채워지면 자동 재실행
    rerender(baseArgs({ signals }));

    await waitFor(() =>
      expect(result.current.duplicateStatus).toEqual({ kind: 'ok' }),
    );
    expect(checkOnEntry).toHaveBeenCalledTimes(1);
    expect(checkOnEntry).toHaveBeenCalledWith({
      surveyId: 'survey-1',
      clientSignals: signals,
    });
  });

  it('blocked 결과면 blocked 로 전이한다 (reason 보존)', async () => {
    checkOnEntry.mockResolvedValue({ blocked: true, reason: 'token_already_used' });
    const { result } = renderHook(() => useDuplicateGuard(baseArgs({ signals })));

    await waitFor(() =>
      expect(result.current.duplicateStatus).toEqual({
        kind: 'blocked',
        reason: 'token_already_used',
      }),
    );
  });

  it('inviteToken 이 있으면 페이로드에 조건부로 포함한다', async () => {
    checkOnEntry.mockResolvedValue({ blocked: false });
    renderHook(() =>
      useDuplicateGuard(baseArgs({ inviteToken: 'tok-1', signals })),
    );

    await waitFor(() => expect(checkOnEntry).toHaveBeenCalledTimes(1));
    expect(checkOnEntry).toHaveBeenCalledWith({
      surveyId: 'survey-1',
      inviteToken: 'tok-1',
      clientSignals: signals,
    });
  });

  it('checkOnEntry 가 실패하면 best-effort 로 ok 로 통과시킨다', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkOnEntry.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useDuplicateGuard(baseArgs({ signals })));

    await waitFor(() =>
      expect(result.current.duplicateStatus).toEqual({ kind: 'ok' }),
    );
    consoleSpy.mockRestore();
  });

  it('effect cleanup 후 도착한 결과는 무시한다 (cancelled 플래그)', async () => {
    let resolveCheck: (v: unknown) => void = () => {};
    checkOnEntry.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const { result, unmount } = renderHook(() =>
      useDuplicateGuard(baseArgs({ signals })),
    );

    await waitFor(() => expect(checkOnEntry).toHaveBeenCalledTimes(1));

    // 결과 도착 전 unmount → cleanup 으로 cancelled = true
    unmount();
    await act(async () => {
      resolveCheck({ blocked: true, reason: 'device_already_responded' });
      await Promise.resolve();
    });

    // unmount 전 마지막 상태는 checking 그대로 (cancelled 로 set 스킵)
    expect(result.current.duplicateStatus).toEqual({ kind: 'checking' });
  });
});

// I-2: skip(유효 테스트 세션)은 entry-check 진행 상태(checking)만 ok 로 우회하고,
// 사후에 외부(쿼터 마감 / 봇가드 / 무효 테스트 토큰)가 set 한 blocked 는 마스킹하지 않고 노출한다.
// (skip 의 목적은 checkOnEntry 네트워크 호출 억제 + checking 우회이지 blocked 은폐가 아님.)
describe('useDuplicateGuard - skip 이어도 blocked 는 노출한다 (I-2)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skip 상태에서 쿼터 마감(quota_closed)이 사후 set 되면 마스킹하지 않고 노출한다', () => {
    const { result } = renderHook(() =>
      useDuplicateGuard(baseArgs({ skip: true, signals })),
    );
    // 진입 checking 은 skip 으로 ok 파생 (entry-check 우회는 유지).
    expect(result.current.duplicateStatus).toEqual({ kind: 'ok' });

    // survey-response-flow handleNext 의 쿼터 게이트가 사후 blocked 로 set 하는 경로.
    act(() => {
      result.current.setDuplicateStatus({ kind: 'blocked', reason: 'quota_closed' });
    });
    expect(result.current.duplicateStatus).toEqual({
      kind: 'blocked',
      reason: 'quota_closed',
    });
  });

  it('skip 상태에서 무효 테스트 토큰(invalid_test_token)이 사후 set 되면 마스킹하지 않고 노출한다', () => {
    const { result } = renderHook(() =>
      useDuplicateGuard(baseArgs({ skip: true, signals })),
    );

    // 테스트 모드 OFF 후 stale 탭의 신규 응답이 서버에서 invalid_test_token 으로 blocked →
    // useResponseLifecycle 가 이 setter 로 set 하는 경로.
    act(() => {
      result.current.setDuplicateStatus({
        kind: 'blocked',
        reason: 'invalid_test_token',
      });
    });
    expect(result.current.duplicateStatus).toEqual({
      kind: 'blocked',
      reason: 'invalid_test_token',
    });
  });
});

// 중단 감지 공통 헬퍼 — mutation catch 3곳(첫 답변 create / blank+complete / resume)의 단일 진입점.
describe('handlePausedMutationError', () => {
  // 헬퍼 인자 기본값. 각 테스트가 필요한 필드만 override 한다.
  function pausedArgs(
    over: Partial<Parameters<typeof handlePausedMutationError>[0]> = {},
  ) {
    return {
      // oRPC RPCHandler 가 비-ORPCError 를 마스킹한 형태 (사유 소실).
      err: new Error('Internal server error'),
      surveyId: 'survey-1' as string | undefined,
      testToken: null as string | null,
      isTestSession: false,
      setDuplicateStatus: vi.fn(),
      ...over,
    } satisfies Parameters<typeof handlePausedMutationError>[0];
  }

  beforeEach(() => {
    forResponse.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('(a) fast-path: 에러 message 에 survey_paused 포함이면 재조회 없이 true + blocked 전환', async () => {
    const args = pausedArgs({
      err: new Error('응답을 받을 수 없는 설문입니다. (survey_paused)'),
    });

    await expect(handlePausedMutationError(args)).resolves.toBe(true);
    expect(args.setDuplicateStatus).toHaveBeenCalledWith({
      kind: 'blocked',
      reason: 'survey_paused',
    });
    expect(forResponse).not.toHaveBeenCalled();
  });

  it('(b) 마스킹된 에러 + 재조회 isPaused=true 면 true + blocked 전환', async () => {
    forResponse.mockResolvedValue({
      control: { isPaused: true, pausedMessage: null, testSession: 'none' },
    });
    const args = pausedArgs();

    await expect(handlePausedMutationError(args)).resolves.toBe(true);
    expect(forResponse).toHaveBeenCalledTimes(1);
    expect(forResponse).toHaveBeenCalledWith({ surveyId: 'survey-1' });
    expect(args.setDuplicateStatus).toHaveBeenCalledWith({
      kind: 'blocked',
      reason: 'survey_paused',
    });
  });

  it('(b-메시지) 재조회 isPaused=true 면 최신 pausedMessage 를 setPausedMessage 로 승격한다', async () => {
    forResponse.mockResolvedValue({
      control: { isPaused: true, pausedMessage: '점검 중입니다', testSession: 'none' },
    });
    const setPausedMessage = vi.fn();
    const args = pausedArgs({ setPausedMessage });

    await expect(handlePausedMutationError(args)).resolves.toBe(true);
    expect(setPausedMessage).toHaveBeenCalledWith('점검 중입니다');
    expect(args.setDuplicateStatus).toHaveBeenCalledWith({
      kind: 'blocked',
      reason: 'survey_paused',
    });
  });

  it('(c) 재조회 isPaused=false 면 false — 호출부가 기존 에러 처리로 복귀', async () => {
    forResponse.mockResolvedValue({
      control: { isPaused: false, pausedMessage: null, testSession: 'none' },
    });
    const args = pausedArgs();

    await expect(handlePausedMutationError(args)).resolves.toBe(false);
    expect(args.setDuplicateStatus).not.toHaveBeenCalled();
  });

  it('(c-null) 재조회 결과가 null(설문 미존재)이어도 false', async () => {
    forResponse.mockResolvedValue(null);
    const args = pausedArgs();

    await expect(handlePausedMutationError(args)).resolves.toBe(false);
    expect(args.setDuplicateStatus).not.toHaveBeenCalled();
  });

  it('(d) 재조회 자체가 throw 해도 삼키고 false (best-effort)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    forResponse.mockRejectedValue(new Error('network'));
    const args = pausedArgs();

    await expect(handlePausedMutationError(args)).resolves.toBe(false);
    expect(args.setDuplicateStatus).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('(e) 유효 테스트 세션이면 재조회 없이 false (중단 예외 대상)', async () => {
    const args = pausedArgs({ isTestSession: true, testToken: 'tok-1' });

    await expect(handlePausedMutationError(args)).resolves.toBe(false);
    expect(forResponse).not.toHaveBeenCalled();
    expect(args.setDuplicateStatus).not.toHaveBeenCalled();
  });

  it('(e-surveyId) surveyId 가 없으면 재조회 없이 false', async () => {
    const args = pausedArgs({ surveyId: undefined });

    await expect(handlePausedMutationError(args)).resolves.toBe(false);
    expect(forResponse).not.toHaveBeenCalled();
    expect(args.setDuplicateStatus).not.toHaveBeenCalled();
  });

  it('testToken 이 있으면 재조회 페이로드에 조건부로 포함한다', async () => {
    forResponse.mockResolvedValue({
      control: { isPaused: true, pausedMessage: null, testSession: 'invalid' },
    });
    const args = pausedArgs({ testToken: 'tok-1' });

    await expect(handlePausedMutationError(args)).resolves.toBe(true);
    expect(forResponse).toHaveBeenCalledWith({ surveyId: 'survey-1', testToken: 'tok-1' });
  });
});
