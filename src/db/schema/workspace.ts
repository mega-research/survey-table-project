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

/**
 * 팀 감사 기록 — 팀 자체(create/rename/dissolve)와 멤버 구성(member_*).
 * 수정·삭제하지 않는 append-only 테이블이다.
 */
export const teamLifecycleEvents = pgTable(
  'team_lifecycle_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    action: text('action').$type<TeamLifecycleAction>().notNull(),
    /** 멤버 사건의 대상. 팀 자체 사건에서는 null 이다. */
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'restrict' }),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    metadata: jsonb('metadata').$type<TeamLifecycleMetadata>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('team_lifecycle_events_team_idx').on(t.teamId)],
);

/**
 * 팀 공용 설문 그룹 — 정리용 묶음 (마이그레이션 0090, 티켓 12).
 *
 * 그룹은 **접근 권한이 아니다.** 담겼다는 사실이 설문을 누가 볼 수 있는지에 영향을 주지 않고,
 * 판정은 계속 `surveys.teamId`·`visibility`·`ownerUserId` 로만 한다. 구조 편집(생성·이름
 * 변경·정렬·삭제)은 모든 active 팀원의 공동 권한이고, 설문을 넣고 빼는 것만 그 설문의
 * `survey.edit` 을 따로 요구한다.
 *
 * 그룹은 팀 소유물이라 **설문이 팀을 옮기면 `surveys.surveyGroupId` 는 NULL 로 내려야 한다** —
 * 팀 해산(티켓 13)·재배치(14)·승계(19)가 지켜야 할 계약이다. DB 복합 FK 로 강제하지 않은
 * 이유는 0090 마이그레이션 헤더에 적었다.
 */
export const surveyGroups = pgTable(
  'survey_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    order: integer('order').notNull().default(0),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // 그룹 이름은 팀 안에서만 유일하다 — 여러 팀이 같은 이름의 그룹을 갖는 것이 정상이다.
  (t) => [
    uniqueIndex('survey_groups_team_name_uq').on(t.teamId, t.name),
    index('survey_groups_team_order_idx').on(t.teamId, t.order),
  ],
);
