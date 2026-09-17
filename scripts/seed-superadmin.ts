/**
 * 슈퍼어드민 시드 — 기존 관리자 계정을 active 슈퍼어드민(internal)으로 발급/승격한다.
 *
 * 사용법:
 *   pnpm auth:seed <email> <name> <password>
 *
 * 이메일이 이미 존재하면 active + 슈퍼어드민(internal)으로 승격만 한다(비밀번호 불변).
 * Better Auth 서버 인스턴스는 server-only 라 스크립트에서 import 할 수 없으므로
 * users/accounts 테이블에 직접 기록한다 (해시는 better-auth 기본 해셔와 동일,
 * accounts.issuer 는 1.7 크리덴셜 규약값 'local:credential').
 *
 * 주의: .env 는 로컬, .env.local 은 원격 DB 를 가리키는 관행 — Next.js 와 같은
 * 우선순위(.env.local > .env)로 로드하며, 셸에서 DATABASE_URL 을 직접 지정하면
 * 그것이 최우선이다.
 */
import dotenv from 'dotenv';

// src/db 가 import 시점에 DATABASE_URL 을 읽으므로, env 로드 후 동적 import 한다.
dotenv.config({ path: ['.env.local', '.env'], quiet: true });

async function main() {
  const [rawEmail, rawName, password] = process.argv.slice(2);
  if (!rawEmail || !rawName || !password) {
    console.error('사용법: pnpm auth:seed <email> <name> <password>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('비밀번호는 최소 8자 이상이어야 합니다.');
    process.exit(1);
  }

  // better-auth 가 이메일을 항상 소문자로 저장·조회하므로 동일 규칙 적용
  const email = rawEmail.trim().toLowerCase();
  const name = rawName.trim();

  const { hashPassword } = await import('better-auth/crypto');
  const { eq } = await import('drizzle-orm');
  const { db } = await import('../src/db');
  const { accounts, users, userStatusEvents } = await import('../src/db/schema');
  const { CREDENTIAL_PROVIDER_ID, LOCAL_CREDENTIAL_ISSUER } = await import(
    '../src/shared/contracts/auth'
  );

  console.log(`대상 DB: ${new URL(process.env['DATABASE_URL'] ?? '').host}`);

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (existing) {
    await db
      .update(users)
      .set({ status: 'active', isSuperadmin: true, userType: 'internal', updatedAt: new Date() })
      .where(eq(users.id, existing.id));
    if (existing.status !== 'active') {
      // 상태를 실제로 바꿨으면 감사 행을 남긴다. CLI 시드에는 행위자 계정이 없어
      // 대상 계정 자신을 changedBy 로 기록한다 (전이 UI 는 티켓 04 소관).
      await db.insert(userStatusEvents).values({
        id: crypto.randomUUID(),
        userId: existing.id,
        fromStatus: existing.status,
        toStatus: 'active',
        changedBy: existing.id,
        reason: 'auth:seed 슈퍼어드민 승격',
      });
    }
    console.log(
      `기존 계정을 active 슈퍼어드민 internal 로 승격했습니다: ${email} — 비밀번호는 변경되지 않습니다`,
    );
    process.exit(0);
  }

  const now = new Date();
  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    name,
    email,
    emailVerified: true,
    status: 'active',
    isSuperadmin: true,
    userType: 'internal',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(accounts).values({
    id: crypto.randomUUID(),
    userId,
    accountId: userId,
    providerId: CREDENTIAL_PROVIDER_ID,
    issuer: LOCAL_CREDENTIAL_ISSUER,
    password: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });

  console.log(`슈퍼어드민을 생성했습니다: ${email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('시드 실패:', err);
  process.exit(1);
});
