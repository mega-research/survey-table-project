import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { type DbOrTx, db } from '@/db';
import { teamMembers, teams } from '@/db/schema';
import type { TeamRole } from '@/shared/contracts/workspace';

export interface ActiveTeamMembership {
  teamId: string;
  teamName: string;
  teamOrder: number;
  role: TeamRole;
}

/**
 * 이 사람의 **유효** 소속 — active 팀의 멤버십만.
 *
 * archived 팀의 행은 감사용으로 남아 있지만 소속으로 세지 않는다(ADR-0011) — 해산 즉시
 * 팀원은 미배치가 되고, 그 사실이 팀 관리·설문 접근 판정 양쪽에서 같은 값으로 보여야 한다.
 * 그래서 "멤버십 조회" 는 이 함수 하나로 모은다.
 */
export async function getActiveTeamMemberships(
  userId: string,
  executor: DbOrTx = db,
): Promise<ActiveTeamMembership[]> {
  return executor
    .select({
      teamId: teamMembers.teamId,
      teamName: teams.name,
      teamOrder: teams.order,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, userId), eq(teams.status, 'active')))
    .orderBy(asc(teams.order), asc(teams.name));
}

/** 이 팀에서의 역할. 소속이 아니면 null — 판정 분기가 undefined 를 헷갈리지 않게 좁힌다. */
export async function getTeamRole(
  userId: string,
  teamId: string,
  executor: DbOrTx = db,
): Promise<TeamRole | null> {
  const memberships = await getActiveTeamMemberships(userId, executor);
  return memberships.find((m) => m.teamId === teamId)?.role ?? null;
}
