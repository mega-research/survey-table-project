import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 로그인 한 건이 시작될 때 읽어둔 `users.sessions_revoked_at` 을 나르는 저장소.
 *
 * 왜 필요한가 — 슈퍼어드민 재설정은 새 해시를 쓰고 대상 세션을 전부 지우지만, 이미 옛 해시를
 * 읽어둔 로그인은 그 커밋 **뒤에** 세션을 INSERT 할 수 있다. 그 세션은 계정이 active 라 실제로
 * 쓸 수 있어, 하필 유출을 의심해 재설정한 그 순간에 계약이 깨진다.
 *
 * 그래서 로그인 시작 시점의 표식을 여기 담아두고, 세션을 만들기 직전에 다시 읽어 비교한다.
 * 값이 달라졌으면 그 사이 폐기가 있었다는 뜻이므로 세션 생성을 취소한다.
 *
 * **시각을 비교하지 않는다.** 앱 서버와 DB 의 시계가 어긋나도 흔들리지 않도록, 같은 컬럼을
 * 두 번 읽어 **바뀌었는지만** 본다.
 *
 * Better Auth 도 자체 AsyncLocalStorage(runWithEndpointContext)를 쓰지만 그쪽 객체에 값을
 * 얹지 않는다 — 내부 구현에 결합되어 버전이 오르면 조용히 깨진다. 우리 저장소를 우리가
 * 감싼다(runWithSessionRevocationMark).
 */
interface SessionRevocationMark {
  /** 로그인 시작 시점의 sessions_revoked_at. 폐기된 적 없으면 null. */
  readonly revokedAt: Date | null;
  /** 표식을 읽은 대상 사용자. 다른 사용자의 세션 생성에는 적용하지 않는다. */
  readonly userId: string;
}

const storage = new AsyncLocalStorage<{ mark: SessionRevocationMark | null }>();

/**
 * 세션을 만들 수 있는 흐름(로그인·비밀번호 변경)을 이 안에서 실행한다.
 * 표식은 흐름 도중에 `setSessionRevocationMark` 로 채운다 — 이메일을 보기 전에는 대상을 모른다.
 */
export function runWithSessionRevocationMark<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ mark: null }, fn);
}

/**
 * 대상이 정해진 시점에 표식을 심는다. 저장소 밖에서 부르면 아무 일도 하지 않는다.
 *
 * **먼저 찍힌 표식이 이긴다.** 이 값의 뜻은 "이 흐름이 시작될 때 폐기가 어디까지 있었나"라서,
 * 흐름 도중에 다시 읽어 덮으면 그 사이 일어난 폐기가 증거째 지워진다 — 막으려던 경합이
 * 정확히 그 창에서 일어난다.
 */
export function setSessionRevocationMark(mark: SessionRevocationMark): void {
  const store = storage.getStore();
  if (store && store.mark === null) store.mark = mark;
}

/** 지금 흐름의 표식. 없으면 null — 판정하지 않는다(fail-open). */
export function getSessionRevocationMark(): SessionRevocationMark | null {
  return storage.getStore()?.mark ?? null;
}

/**
 * 이 세션을 만들어도 되는가.
 *
 * 표식이 없으면 통과시킨다 — 세션을 만드는 경로가 로그인만은 아니고(비밀번호 변경 후 재발급),
 * 판정할 근거가 없을 때 막으면 정상 로그인을 잃는다. 막아야 할 것은 "표식을 심어둔 흐름인데
 * 그 사이 폐기가 일어난" 경우 하나다.
 */
export function isSessionCreationStale(userId: string, currentRevokedAt: Date | null): boolean {
  const mark = getSessionRevocationMark();
  if (!mark || mark.userId !== userId) return false;
  return (mark.revokedAt?.getTime() ?? null) !== (currentRevokedAt?.getTime() ?? null);
}
