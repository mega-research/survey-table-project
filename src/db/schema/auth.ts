import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { FieldworkRole, UserStatus, UserType } from '@/shared/contracts/auth';

/**
 * Better Auth 관할 인증 테이블 4종(users/sessions/accounts/verifications)
 * + 계정 상태 감사 테이블(user_status_events).
 *
 * id 는 Better Auth 설정(advanced.database.generateId)이 crypto.randomUUID() 로
 * 생성해 삽입하므로 DB default 가 없다. 시드 스크립트도 동일하게 UUID 를 직접 넣는다.
 *
 * 프로덕션·스테이징 DB 에는 5테이블이 선반영돼 있다(0101 재생용 마이그레이션 참조).
 * better-auth 1.7 어댑터 기대와의 차이(accounts.issuer 등)는 0102 가 해소한다.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  // 기본값 'pending' 은 안전장치다 — v2 에서 계정 생성은 항상 명시적 active 발급이므로
  // (ADR-0018) 어떤 경로가 status 없이 행을 만들면 로그인 불가 상태로 남는 편이 안전하다.
  status: text('status').$type<UserStatus>().notNull().default('pending'),
  isSuperadmin: boolean('is_superadmin').notNull().default(false),
  // 직책 — 슈퍼어드민이 사용자 관리에서 입력 (internal 전용, 티켓 03)
  jobTitle: text('job_title'),
  // 소속 기관 메모 — guest 전용 자유 입력 (0103). internal 은 팀 멤버십(티켓 06),
  // fieldwork 는 실사 업체 엔티티(티켓 24)에서 소속을 얻으므로 이 컬럼을 쓰지 않는다.
  organization: text('organization'),
  // 계정 유형 — internal | guest | fieldwork (ADR-0018, 0102 마이그레이션)
  userType: text('user_type').$type<UserType>().notNull().default('internal'),
  // 소속 실사 업체 — fieldwork 전용 (0110, 티켓 24).
  //
  // FK 는 0110 마이그레이션의 ALTER TABLE 이 만든다. drizzle 에서 `.references()` 를 붙이지
  // 말 것 — `fieldwork_orgs` 는 workspace.ts 에 있고 그 파일이 이 파일의 `users` 를 쓰므로
  // 순환 import 가 된다(`survey_responses.contactTargetId` 와 같은 선례).
  fieldworkOrgId: uuid('fieldwork_org_id'),
  // 업체 내 역할 — leader | worker. fieldwork 전용 (0110).
  //
  // 두 컬럼과 user_type 의 정합은 **DB CHECK 가 지킨다**(users_fieldwork_fields_check):
  // fieldwork 면 둘 다 있어야 하고, 아니면 둘 다 NULL 이어야 한다. 한 행 안의 조건이라
  // survey_participants.kind 와 달리 CHECK 로 걸 수 있다.
  fieldworkRole: text('fieldwork_role').$type<FieldworkRole>(),
  // 세션이 마지막으로 일괄 폐기된 시각 (0104, 티켓 30). 재설정·상태 전이가 갱신한다.
  // 로그인 경합 판정에서 **값이 바뀌었는지**만 보므로 시각 자체의 정확도는 중요하지 않다.
  sessionsRevokedAt: timestamp('sessions_revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    // better-auth 1.7 신설 — 이메일+비밀번호 계정은 'local:credential'
    // (createLocalAccountIssuer). OAuth 미사용이므로 이 값 하나만 실린다.
    issuer: text('issuer').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('accounts_user_id_idx').on(t.userId),
    // better-auth 1.7 어댑터 기대 인덱스 — findAccountByKey(issuer, accountId) 유일 조회.
    uniqueIndex('accounts_issuer_account_id_unique').on(t.issuer, t.accountId),
  ],
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

/** 계정 상태 변경 감사 기록. 수정·삭제하지 않는 append-only 테이블이다. */
export const userStatusEvents = pgTable(
  'user_status_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    fromStatus: text('from_status').$type<UserStatus>().notNull(),
    toStatus: text('to_status').$type<UserStatus>().notNull(),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_status_events_user_id_idx').on(t.userId),
    index('user_status_events_changed_by_idx').on(t.changedBy),
  ],
);
