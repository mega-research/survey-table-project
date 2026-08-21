import { describe, expect, it, vi } from 'vitest';

import { runAsyncAction } from './run-async-action';

/**
 * 러너 계약 회귀 테스트.
 *
 * 이 함수는 10개 컴포넌트의 try/catch/finally 를 대신 진다. 계약이 어긋나면 그 전부에서
 * 에러 처리나 pending 해제가 조용히 달라지므로, 원래 try/catch/finally 와 동일함을 여기서 못박는다.
 */
describe('runAsyncAction', () => {
  it('성공하면 action 의 반환값을 그대로 돌려주고 onSettled 만 부른다', async () => {
    const onError = vi.fn();
    const onSettled = vi.fn();

    await expect(runAsyncAction(async () => 'ok', { onError, onSettled })).resolves.toBe('ok');
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('실패하면 onError 로 잡고 그 반환값을 돌려준다 — catch 가 값을 만드는 형태 보존', async () => {
    const onSettled = vi.fn();
    const err = new Error('boom');

    await expect(
      runAsyncAction<string>(
        async () => {
          throw err;
        },
        { onError: (e) => `handled:${(e as Error).message}`, onSettled },
      ),
    ).resolves.toBe('handled:boom');
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('onError 가 다시 던지면 onSettled 를 거친 뒤 호출부로 전파된다 — rethrow 보존', async () => {
    // use-survey-sync 가 이 형태다. 삼키면 상위 catch 가 죽는다.
    const onSettled = vi.fn();
    const err = new Error('rethrown');

    await expect(
      runAsyncAction(
        async () => {
          throw err;
        },
        {
          onError: () => {
            throw err;
          },
          onSettled,
        },
      ),
    ).rejects.toBe(err);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('실행 순서는 action → onError → onSettled 다', async () => {
    const order: string[] = [];

    await runAsyncAction<null>(
      async () => {
        order.push('action');
        throw new Error('x');
      },
      {
        onError: () => {
          order.push('onError');
          return null;
        },
        onSettled: () => order.push('onSettled'),
      },
    );

    expect(order).toEqual(['action', 'onError', 'onSettled']);
  });

  it('async onError 는 끝날 때까지 기다린 뒤 onSettled 를 부른다', async () => {
    const order: string[] = [];

    await runAsyncAction<null>(
      async () => {
        throw new Error('x');
      },
      {
        onError: async () => {
          await Promise.resolve();
          order.push('onError-done');
          return null;
        },
        onSettled: () => order.push('onSettled'),
      },
    );

    expect(order).toEqual(['onError-done', 'onSettled']);
  });

  it('action 이 조기 return 해도 onSettled 는 실행된다', async () => {
    const onSettled = vi.fn();

    await expect(
      runAsyncAction(async () => undefined, { onError: () => undefined, onSettled }),
    ).resolves.toBeUndefined();
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
