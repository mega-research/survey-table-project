import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDuplicateGuard } from '@/components/survey-response/hooks/use-duplicate-guard';
import type { ClientSignals } from '@/lib/duplicate-detection/types';
import type { Survey } from '@/types/survey';

// RPC client 모킹 — 진입 시 중복검사 경로(duplicate.checkOnEntry)만 사용.
const checkOnEntry = vi.fn();

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    surveyResponse: {
      duplicate: {
        checkOnEntry: (...args: unknown[]) => checkOnEntry(...args),
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
