/**
 * 외주 실사 링크 세션 procedure — 접속과 나가기 (ADR-0026, .pen FLOW 10-3).
 *
 * **형제 `fieldwork-links.ts` 와 청중이 정반대다.** 저쪽은 연구원이 부르는 `authed` 관리
 * 표면이고 이쪽은 **외주가 부르는 `pub` 표면**이다. 같은 파일에 두지 않은 이유가 그것이다 —
 * 한 그룹에 섞이면 「이 표면은 로그인 없이 열린다」가 코드에서 읽히지 않고, 관리 표면을 조일
 * 때 세션 표면이 조용히 따라 닫힌다.
 *
 * 인증은 링크 주소의 토큰 + 비밀번호 한 칸이고, 성공하면 `fw_<token>` 쿠키가 심긴다.
 * 판정은 전부 코어(`server/fieldwork-link`)가 하고 여기는 **쿠키를 심고 지우는 일**만 한다 —
 * 그 일은 코어가 할 수 없다(요청/응답을 만지지 않는 자리다).
 *
 * **쿠키를 쓰는 procedure 가 여기 하나다.** AGENTS.md 의 표면 선택 원칙은 「redirect+쿠키
 * 의미론」을 서버 액션의 사유로 적었는데, 이 표면이 그쪽이 아닌 이유는 둘이다. ① 무차별 대입
 * 방어가 필수이고 2단 레이트리밋은 oRPC 미들웨어(`withRateLimit`)에만 있다 — 서버 액션으로
 * 옮기면 그 판정을 손으로 다시 짜야 한다. ② redirect 가 필요하지 않다: 성공 뒤 이동은 화면이
 * 전체 리로드로 하고, 목적지 판정은 서버가 다시 한다(로그인 폼과 같은 선례).
 * oRPC 는 Route Handler(`/api/rpc`) 위에서 돌므로 `cookies()` 쓰기가 허용된다 — 프로덕션
 * 빌드로 Set-Cookie 가 실제로 나가는 것을 확인했다.
 *
 * 무차별 대입 대상이라 `withRateLimit('fieldwork-link-auth')` 를 태운다. 클라이언트 축은
 * 입력의 `token` 이고 IP 전체 가드가 짝으로 붙는다(토큰 축 단독은 회전으로 우회된다).
 */
import { cookies } from 'next/headers';

import {
  authenticateFieldworkLink,
  type FieldworkLinkSessionCookie,
} from '@/server/fieldwork-link';
import { pub, withRateLimit } from '@/server/orpc';
import {
  FieldworkLinkAuthOutput,
  WorkspaceActionOutput,
} from '@/shared/contracts/workspace-io';
import { fieldworkLinkCookieName, isFieldworkLinkToken } from '@/lib/auth/fieldwork-link-session';

import {
  FieldworkLinkAuthInput,
  FieldworkLinkSignOutInput,
} from '../domain/fieldwork-link';

/**
 * 쿠키 속성 — path 가 `/` 인 것이 계약이다.
 *
 * 대리 응답이 `/survey/...` 로 나가므로 path 를 `/fw/...` 로 좁히면 그 화면에 세션이 실리지
 * 않는다. 대신 이름에 토큰이 들어 있어 설문끼리 섞이지 않는다(lib/auth/fieldwork-link-session).
 *
 * `secure` 를 프로덕션에서만 켜는 것은 로컬 http 개발 때문이다 — 켠 채로 두면 localhost 에서
 * 쿠키가 아예 심기지 않아 기능이 통째로 동작하지 않는다.
 */
function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

async function setSessionCookie(cookie: FieldworkLinkSessionCookie): Promise<void> {
  (await cookies()).set({
    name: cookie.name,
    value: cookie.value,
    maxAge: cookie.maxAgeSeconds,
    ...sessionCookieOptions(),
  });
}

/**
 * 비밀번호 한 칸으로 접속한다.
 *
 * 거부를 **에러가 아니라 결과로** 돌려준다 — 「틀렸다」와 「닫혔다」는 둘 다 정상 경로이고
 * 화면이 하는 일이 다르다(같은 자리에서 다시 받기 / 닫힘 화면으로 갈아타기). 에러 코드로
 * 가르면 그 코드가 곧 링크 존재 여부의 신호가 되기도 한다.
 */
const authenticate = pub
  .use(withRateLimit('fieldwork-link-auth'))
  .input(FieldworkLinkAuthInput)
  .output(FieldworkLinkAuthOutput)
  .handler(async ({ input }) => {
    const result = await authenticateFieldworkLink(input.token, input.password);
    if (!result.ok) return { ok: false as const, reason: result.reason };
    await setSessionCookie(result.cookie);
    return { ok: true as const };
  });

/**
 * 나가기 — **그 링크의 쿠키 하나만** 지운다.
 *
 * 공용 PC 에서 자리를 비울 때 쓰는 표면이고(스토리 20), 두 조사를 병행하는 브라우저에서
 * 다른 조사의 세션까지 끊으면 그 사람은 다시 비밀번호를 받아야 한다.
 *
 * 토큰이 실재하는지 묻지 않는다 — 없는 토큰으로 불러도 지울 쿠키가 없을 뿐이고, 여기서
 * DB 를 읽으면 로그아웃이 링크 존재 확인 창구가 된다.
 */
const signOut = pub
  .input(FieldworkLinkSignOutInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input }) => {
    if (!isFieldworkLinkToken(input.token)) return { success: true } as const;
    (await cookies()).delete({
      name: fieldworkLinkCookieName(input.token),
      path: sessionCookieOptions().path,
    });
    return { success: true } as const;
  });

export const fieldworkLinkSession = { authenticate, signOut };
