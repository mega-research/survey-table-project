import { afterEach, describe, expect, it, vi } from 'vitest';

const captureMessage = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

import { scheduleSlowRpcWarning } from '@/server/rpc-timeout';

describe('scheduleSlowRpcWarning', () => {
  afterEach(() => {
    vi.useRealTimers();
    captureMessage.mockReset();
  });

  it('RPC 요청이 경고 시간보다 오래 지속되면 Sentry warning 을 남긴다', () => {
    vi.useFakeTimers();
    const request = new Request('https://example.com/api/rpc/surveyBuilder/read/list', {
      method: 'POST',
    });

    scheduleSlowRpcWarning(request, 1_000);

    vi.advanceTimersByTime(999);
    expect(captureMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(captureMessage).toHaveBeenCalledWith(
      'Slow RPC request',
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({
          operation: 'rpc_slow_request',
          method: 'POST',
          path: '/api/rpc/surveyBuilder/read/list',
        }),
      }),
    );
  });

  it('요청이 경고 시간 전에 끝나면 타이머를 해제한다', () => {
    vi.useFakeTimers();
    const request = new Request('https://example.com/api/rpc/surveyBuilder/read/list');

    const clearWarning = scheduleSlowRpcWarning(request, 1_000);
    clearWarning();
    vi.advanceTimersByTime(1_000);

    expect(captureMessage).not.toHaveBeenCalled();
  });
});
