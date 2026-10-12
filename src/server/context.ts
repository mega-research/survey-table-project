import 'server-only';

import { db } from '@/db';
import {
  readFieldworkLinkSessions,
  type AccessLinkSession,
} from '@/lib/auth/access-link-session';
import { readSessionUser } from '@/lib/auth/session';
import type { AuthUser } from '@/shared/contracts/auth';

// 인증 사용자 모양은 shared/contracts/auth 소관 — 컨텍스트 소비자가 함께 받도록 되내보낸다.
export type { AuthUser };

export interface ORPCContext {
  db: typeof db;
  user: AuthUser | null;
  /**
   * 요청 헤더. rate limit 미들웨어의 신뢰 클라이언트 IP 추출과 Better Auth 세션 API
   * (changePassword 등) 호출에 사용한다.
   * route handler 경로에서만 채워지고, RSC 직접 호출/테스트 경로에는 없을 수 있다
   * (이 경로는 pub rate-limit 미들웨어를 거치지 않으므로 영향 없음). optional 로 둬서
   * 컨텍스트를 직접 구성하는 호출부(RSC·테스트)가 headers 를 강제로 채우지 않게 한다.
   */
  headers?: Headers;
  /**
   * 요청이 들고 온 **외주 실사 링크 세션 후보** — 서명만 검증한 것들 (ADR-0026).
   *
   * 스펙은 `actor: Actor | null` 한 칸을 적었지만 **목록이 맞다.** 업체가 두 조사를 병행하면
   * 한 브라우저에 `fw_<token>` 쿠키가 여럿 서고, 그 중 어느 것을 볼지는 입력의 설문 id 가
   * 정한다 — 컨텍스트를 만드는 시점에는 입력이 아직 파싱되지 않았다.
   *
   * **후보일 뿐이다.** 여기까지는 「우리가 서명한 쿠키인가」이고, 「지금도 유효한가」(링크 종료·
   * 설문 중단·비밀번호 변경)는 관문이 링크 행을 읽어 답한다(server/access-link). 그래서
   * `user` 를 계정 전용으로 남겨 둔 것이 안전 방향이다 — authed·superadmin·account 베이스는
   * 이 칸을 보지 않으므로 링크 요청이 내부 표면에 닿는 순간 그대로 UNAUTHORIZED 가 된다.
   */
  linkSessions?: readonly AccessLinkSession[];
}

/**
 * RSC와 procedure 양쪽이 재사용하는 요청 컨텍스트.
 * Better Auth 세션을 한 번 읽어 user를 채운다(없으면 null).
 * route handler 는 request.headers 를 전달하고, RSC 경로는 생략 가능(빈 Headers).
 */
export async function createContext(headers: Headers = new Headers()): Promise<ORPCContext> {
  // 링크 쿠키가 없으면 비용이 0 이다 — 헤더 한 줄을 보고 끝난다(응답자·연구원 요청의 전부).
  return {
    db,
    user: await readSessionUser(headers),
    headers,
    linkSessions: readFieldworkLinkSessions(headers),
  };
}
