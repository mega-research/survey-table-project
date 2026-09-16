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

  // --- onSettled 생략 계약 ---
  // 뒤처리가 없는 호출부는 이 인자를 빼고 부른다. 생략이 바꾸는 것은 "마지막에 부를 것이
  // 없다" 뿐이고, 반환값과 에러 전파는 준 경우와 같아야 한다.

  it('onSettled 를 생략해도 성공 경로는 그대로다 — 뒤처리 없는 호출부', async () => {
    const onError = vi.fn();

    await expect(runAsyncAction(async () => 'ok', { onError })).resolves.toBe('ok');
    expect(onError).not.toHaveBeenCalled();
  });

  it('onSettled 를 생략해도 onError 가 만든 값을 그대로 돌려준다', async () => {
    await expect(
      runAsyncAction<string>(
        async () => {
          throw new Error('boom');
        },
        { onError: (e) => `handled:${(e as Error).message}` },
      ),
    ).resolves.toBe('handled:boom');
  });

  it('onSettled 를 생략하고 onError 가 다시 던져도 그 에러가 그대로 전파된다', async () => {
    // 구현이 `handlers.onSettled?.()` 의 `?.` 를 잃으면 finally 에서 TypeError 가 나
    // 원래 에러를 덮는다. 상위 catch 가 엉뚱한 에러를 보게 되므로 동일성까지 못박는다.
    //
    // action 과 onError 가 **다른** 에러를 던진다 — 같은 객체를 쓰면 전파된 것이 onError 가
    // 던진 것인지 action 의 것이 그대로 새어나온 것인지 구별되지 않아, onError 를 부르지 않는
    // 구현도 통과한다.
    const fromAction = new Error('from-action');
    const fromOnError = new Error('rethrown');
    const onError = vi.fn(() => {
      throw fromOnError;
    });

    await expect(
      runAsyncAction(
        async () => {
          throw fromAction;
        },
        { onError },
      ),
    ).rejects.toBe(fromOnError);
    expect(onError).toHaveBeenCalledWith(fromAction);
  });

  it('onSettled 유무가 반환·전파를 바꾸지 않는다 — 생략은 뒤처리만 없앤다', async () => {
    const onSettled = vi.fn();
    const failing = async (): Promise<string> => {
      throw new Error('boom');
    };

    // 값 경로 — 준 쪽과 뺀 쪽이 같은 값을 돌려준다. onError 가 async 여도 같다.
    const onError = async (e: unknown) => `handled:${(e as Error).message}`;
    await expect(runAsyncAction(failing, { onError, onSettled })).resolves.toBe('handled:boom');
    await expect(runAsyncAction(failing, { onError })).resolves.toBe('handled:boom');
    expect(onSettled).toHaveBeenCalledOnce();

    // 전파 경로 — onError 가 다시 던지는 호출부(contact-attempt-add-card)가 이 형태다.
    const err = new Error('rethrown');
    const rethrowing = () => {
      throw err;
    };
    await expect(runAsyncAction<string>(failing, { onError: rethrowing, onSettled })).rejects.toBe(
      err,
    );
    await expect(runAsyncAction<string>(failing, { onError: rethrowing })).rejects.toBe(err);
    expect(onSettled).toHaveBeenCalledTimes(2);
  });
});
