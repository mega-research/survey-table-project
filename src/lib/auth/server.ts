import 'server-only';

import { BASE_ERROR_CODES, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { accounts, sessions, users, verifications } from '@/db/schema';

import { isSessionCreationStale, setSessionRevocationMark } from './session-revocation';

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const ONE_DAY_SECONDS = 60 * 60 * 24;

function getTrustedOrigins(): string[] {
  const configured =
    process.env['BETTER_AUTH_TRUSTED_ORIGINS']
      ?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  const baseUrl = process.env['BETTER_AUTH_URL'];
  return [...new Set([...(baseUrl ? [baseUrl] : []), ...configured])];
}

/**
 * Better Auth 서버 인스턴스 — 인증의 단일 진입점.
 *
 * - 계정/세션은 우리 Postgres(users/sessions/accounts/verifications)에 저장.
 * - user id 는 UUID 로 생성(기존 uuid 컬럼 관행과 타입 일관성).
 * - 세션은 항상 30일 + 하루 한 번 사용 시 연장(로그인 유지 옵션 없음 — 스펙 결정).
 * - 공개 가입 없음(disableSignUp) — 계정은 슈퍼어드민이 직접 발급한다(ADR-0018).
 *   이메일 비밀번호 재설정도 없다 — 분실은 슈퍼어드민 재설정으로 처리(티켓 04).
 * - sign-in 전에 active 상태를 검사해 비활성 계정(pending/rejected/suspended/departed)의
 *   세션 생성을 차단한다. 실패 응답은 잘못된 비밀번호와 구분되지 않는다(아래 훅 주석).
 */
export const auth = betterAuth({
  baseURL: process.env['BETTER_AUTH_URL'],
  trustedOrigins: getTrustedOrigins(),
  secret: process.env['BETTER_AUTH_SECRET'],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    disableSignUp: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: THIRTY_DAYS_SECONDS,
    updateAge: ONE_DAY_SECONDS,
  },
  user: {
    additionalFields: {
      // 'pending' 기본값은 안전장치 — v2 계정 생성은 항상 명시적 active 발급이므로
      // status 없이 만들어진 행은 로그인 불가로 남는 편이 안전하다(ADR-0018).
      status: { type: 'string', defaultValue: 'pending', input: false },
      isSuperadmin: { type: 'boolean', defaultValue: false, input: false },
      jobTitle: { type: 'string', required: false, input: false },
      userType: { type: 'string', defaultValue: 'internal', input: false },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email') return;
      const raw = typeof ctx.body?.email === 'string' ? ctx.body.email : '';
      // Better Auth 는 **원본** 이메일에 z.email() 을 걸어 형식 불량이면 400 을 낸다. 우리가
      // trim 한 값으로만 조회하면 " known@a.b " 같은 입력에서 비활성 계정은 이 훅의 401 로,
      // 그 밖은 Better Auth 의 400 으로 갈려 계정 상태가 응답 코드로 새어 나간다.
      // 원본이 Better Auth 검증을 통과하지 못할 모양이면 판정을 그쪽에 넘긴다.
      if (raw !== raw.trim()) return;
      const email = raw.toLowerCase();
      if (!email) return;
      const user = await db.query.users.findFirst({
        where: eq(users.email, email),
        columns: { id: true, status: true, sessionsRevokedAt: true },
      });
      // 로그인이 시작된 시점의 폐기 표식을 담아둔다. 이 흐름이 세션을 만들기 직전에 다시 읽어
      // 비교한다 — 그 사이 슈퍼어드민이 재설정·전이를 했다면 이 로그인은 옛 해시로 통과한
      // 것이므로 세션을 만들지 않는다(티켓 30).
      if (user) {
        setSessionRevocationMark({ userId: user.id, revokedAt: user.sessionsRevokedAt });
      }
      if (user && user.status !== 'active') {
        // 차단 401이 미존재 계정 401과 응답 시간까지 구분되지 않도록 네이티브 실패 경로와
        // 동일하게 더미 해시를 수행한다(better-auth sign-in 라우트는 계정 없음/비밀번호
        // 없음 분기에서도 동일하게 ctx.context.password.hash 를 거친 뒤 401을 던진다).
        const dummyPassword =
          typeof ctx.body?.password === 'string' ? ctx.body.password : 'timing-equalization';
        await ctx.context.password.hash(dummyPassword);
        // 이메일 존재 여부를 노출하지 않기 위해 Better Auth 가 잘못된 비밀번호일 때
        // 던지는 것과 동일한 코드/메시지를 사용한다(응답 바디까지 완전히 동일).
        throw APIError.from('UNAUTHORIZED', BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD);
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        /**
         * 세션 INSERT 직전 마지막 관문.
         *
         * 로그인이 시작된 뒤 대상 계정의 세션이 일괄 폐기됐다면(재설정·상태 전이) 이 로그인은
         * 이미 무효인 크리덴셜로 통과한 것이다. 해시 검증은 이미 끝났고 되돌릴 수 없으므로,
         * 남은 유일한 자리가 여기다.
         *
         * `false` 를 돌려주면 세션은 안 만들어지지만 sign-in 은 **성공으로 응답한다** — 쿠키
         * 없는 가짜 성공이라 클라이언트가 로그인됐다고 믿는다. 그래서 던진다. 문구·코드는
         * 잘못된 비밀번호와 같은 것을 써서 계정 상태가 응답으로 새지 않게 한다.
         */
        before: async (session) => {
          const userId = (session as { userId?: unknown }).userId;
          if (typeof userId !== 'string') return;
          const row = await db.query.users.findFirst({
            where: eq(users.id, userId),
            columns: { sessionsRevokedAt: true },
          });
          if (isSessionCreationStale(userId, row?.sessionsRevokedAt ?? null)) {
            throw APIError.from('UNAUTHORIZED', BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD);
          }
          return;
        },
      },
    },
  },
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
  plugins: [nextCookies()],
});
