import 'server-only';

import { asc, eq } from 'drizzle-orm';

import { type DbOrTx, db } from '@/db';
import { teams } from '@/db/schema';

/**
 * 활성 팀 목록 — 이름만 필요한 소비자용 projection.
 *
 * 팀 관리 화면의 목록(workspace 도메인의 listTeams)은 멤버 수·설문 수 지표를 함께 뽑는다.
 * 여기는 "고를 수 있는 팀" 처럼 이름만 필요한 자리를 위한 것이라, 그 무거운 조회를 도메인
 * 밖으로 끌어오지 않게 한다.
 */
export async function listActiveTeams(
  executor: DbOrTx = db,
): Promise<{ id: string; name: string }[]> {
  return executor
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.status, 'active'))
    .orderBy(asc(teams.order), asc(teams.name));
}
