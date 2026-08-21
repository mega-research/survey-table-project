/**
 * 비동기 액션을 try/catch/finally 로 감싸는 모듈 최상위 러너.
 *
 * React Compiler 는 TryStatement 를 낮추지 못해, try 가 이벤트 핸들러 안에 있어도
 * 가장 바깥 컴포넌트/훅 전체를 skip 한다. 반면 모듈 최상위 함수는 컴파일러의 판정
 * 대상 자체가 아니라 이벤트조차 남기지 않는다. 그래서 try 를 여기 한 곳에 가두고
 * 호출부에는 남기지 않는다.
 *
 * 실행 순서는 원래 try/catch/finally 와 같다 — action → (예외 시) onError → onSettled.
 * onError 가 다시 throw 하면 onSettled 실행 후 그대로 호출부로 전파된다(rethrow 보존).
 */
export async function runAsyncAction<T>(
  action: () => Promise<T>,
  handlers: {
    onError: (error: unknown) => T | Promise<T>;
    onSettled: () => void;
  },
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const handled = handlers.onError(error);
    // onError 가 Promise 를 돌려줄 때만 기다린다. 동기 핸들러에까지 await 를 끼우면
    // onSettled 가 마이크로태스크 하나만큼 밀려 원래 finally 순서와 달라진다.
    return handled instanceof Promise ? ((await handled) as T) : (handled as T);
  } finally {
    handlers.onSettled();
  }
}
