import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  TeamLifecycleAction,
  TeamLifecycleMetadata,
  TeamRole,
  TeamStatus,
} from '@/shared/contracts/workspace';

import { users } from './auth';

/**
 * 팀 — 설문 소유·접근의 최소 워크스페이스이자 기본 접근 경계 (마이그레이션 0088).
 *
 * 이름은 전체 조직 경로를 포함하지만(`연구1본부 - 1팀`) 권한 판정은 언제나 id 로 한다
 * (ADR-0008). 「메가리서치」(시스템 전체 보기)는 팀이 아니라 이 테이블에 행이 없다(ADR-0006).
 * 해산은 하드 삭제가 아니라 status='archived' 전환이다(ADR-0011, 티켓 13).
 */
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    order: integer('order').notNull().default(0),
    status: text('status').$type<TeamStatus>().notNull().default('active'),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // 활성 팀 이름은 유일하다 — archived 는 목록에서 사라지므로 같은 이름을 다시 쓸 수 있다.
  (t) => [uniqueIndex('teams_active_name_uq').on(t.name).where(sql`${t.status} = 'active'`)],
);

/**
 * 팀 멤버십 — 소속의 단일 정본(ADR-0008).
 *
 * archived 팀의 행은 감사용으로 남기고 **유효 소속 계산에서 뺀다** — 해산 즉시 팀원은
 * 미배치가 된다(ADR-0011). 서로 다른 팀에 동시 소속(겸직)은 허용이라 user_id 단독
 * UNIQUE 는 없다. 겸직을 만들 수 있는 사람은 서비스 레이어가 좁힌다(슈퍼어드민 전용).
 */
export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role').$type<TeamRole>().notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('team_members_team_user_uq').on(t.teamId, t.userId),
    index('team_members_user_id_idx').on(t.userId),
  ],
);

/** 팀 생성·이름 변경·해산 감사 기록. 수정·삭제하지 않는 append-only 테이블이다. */
export const teamLifecycleEvents = pgTable(
  'team_lifecycle_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    action: text('action').$type<TeamLifecycleAction>().notNull(),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    metadata: jsonb('metadata').$type<TeamLifecycleMetadata>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('team_lifecycle_events_team_idx').on(t.teamId)],
);
