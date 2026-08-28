/**
 * procedure 호출용 최소 컨텍스트 — 음성 스위트가 주체를 직접 만들 때 쓴다.
 *
 * `{ db, user, headers }` 리터럴이 스위트마다 복제되면 한 곳만 필드가 늘어도 나머지가
 * 조용히 옛 모양으로 남는다(`userType` 이 붙던 티켓 03 이 그랬다).
 *
 * `db` 를 `never` 로 두는 것은 의도다 — 서비스는 컨텍스트가 아니라 `@/db` 를 직접 쓰므로
 * 여기 실린 값을 아무도 읽지 않는다. 읽는 코드가 생기면 그 자리에서 터지는 편이 낫다.
 */
import type { ORPCContext } from '@/server/context';

export interface InternalActorOptions {
  id: string;
  isSuperadmin?: boolean;
  name?: string;
}

/** 활성 내부 계정 주체. */
export function internalActorContext(options: InternalActorOptions): ORPCContext {
  return {
    db: {} as never,
    user: {
      id: options.id,
      email: `${options.id}@megaresearch.co.kr`,
      name: options.name ?? '테스터',
      status: 'active',
      isSuperadmin: options.isSuperadmin ?? false,
      userType: 'internal',
    },
    headers: new Headers(),
  };
}

export interface GuestActorOptions {
  id: string;
  name?: string;
  /** 계정 유형 — 실사 축(티켓 24)도 같은 모양을 쓰므로 값으로 받는다. */
  userType?: 'guest' | 'fieldwork';
}

/**
 * 활성 **비내부** 계정 주체 (티켓 21).
 *
 * `isSuperadmin: true` 로 두는 것이 의도다 — 비내부 계정에 그 플래그가 실려 와도 열리면
 * 안 되고, 음성 스위트는 가장 불리한 조건에서 물어야 한다.
 */
export function guestActorContext(options: GuestActorOptions): ORPCContext {
  return {
    db: {} as never,
    user: {
      id: options.id,
      email: `${options.id}@client.example.com`,
      name: options.name ?? '클라이언트',
      status: 'active',
      isSuperadmin: true,
      userType: options.userType ?? 'guest',
    },
    headers: new Headers(),
  };
}
