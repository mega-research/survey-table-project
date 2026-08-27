import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import { surveyGroups, surveys, teams } from '@/db/schema';
import { escapeLikePattern } from '@/lib/operations/filter-shared';
import { isUniqueViolation } from '@/lib/pg-error';
import {
  type SurveyAccessUser,
  loadAccessSubject,
  resolveSurveyCapabilities,
} from '@/server/survey-access';

import {
  type CollectSurveysIntoGroupInput,
  type CreateSurveyGroupInput,
  type CreateSurveyGroupOutput,
  DuplicateSurveyGroupNameError,
  type ListSurveyGroupsOutput,
  type ListUngroupedSurveysOutput,
  type MoveSurveyToGroupInput,
  type RenameSurveyGroupInput,
  type ReorderSurveyGroupsInput,
  SurveyAlreadyGroupedError,
  SurveyGroupNotFoundError,
  SurveyGroupTargetNotFoundError,
  SurveyTeamMismatchError,
} from '../domain/survey-groups';
import { TeamNotFoundError, type WorkspaceActionOutput } from '../domain/teams';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 팀의 그룹 목록 + 소속 설문 수 (.pen FLOW 2-1).
 *
 * 세는 것은 **요청자가 볼 수 있는 설문**이다. `invite_only` 는 소유 팀 팀원에게만 숨기는데
 * (스펙 §3) 카운트가 그것까지 세면 사이드바는 「임원 조사 3」이라 하고 그룹 화면에는 카드가
 * 1장만 나온다 — 뺄셈 한 번으로 "내게 숨겨진 설문이 2건 있다" 가 드러난다. 그래서 조인 조건이
 * 목록 조회(`buildSurveyScopeFilter` 의 seesInviteOnly)와 같은 술어를 쓴다.
 *
 * 조인에 `surveys.teamId = surveyGroups.teamId` 도 함께 건다. 그룹은 팀 소유물이라 팀이 다른
 * 설문이 그룹에 남아 있으면 그건 이미 깨진 상태고(팀을 옮기는 흐름이 surveyGroupId 를 안 내린
 * 경우), 그 행을 세어 보여주면 깨진 상태를 정상처럼 보이게 한다.
 */
export async function listSurveyGroups(
  user: SurveyAccessUser,
  teamId: string,
): Promise<ListSurveyGroupsOutput> {
  const subject = await loadAccessSubject(user);
  const seesInviteOnly = subject.isSuperadmin || subject.leaderTeamIds.includes(teamId);

  return db
    .select({
      id: surveyGroups.id,
      name: surveyGroups.name,
      order: surveyGroups.order,
      surveyCount: sql<number>`count(${surveys.id})::int`,
    })
    .from(surveyGroups)
    .leftJoin(
      surveys,
      and(
        eq(surveys.surveyGroupId, surveyGroups.id),
        eq(surveys.teamId, surveyGroups.teamId),
        isNull(surveys.deletedAt),
        seesInviteOnly
          ? undefined
          : or(eq(surveys.visibility, 'team'), eq(surveys.ownerUserId, subject.userId)),
      ),
    )
    .where(eq(surveyGroups.teamId, teamId))
    .groupBy(surveyGroups.id)
    .orderBy(asc(surveyGroups.order), asc(surveyGroups.name));
}

/** 이 팀이 아직 살아 있는가 — 해산된 팀에는 그룹 표면 전체가 닫힌다(티켓 13). */
export async function isActiveTeam(teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.status, 'active')))
    .limit(1);
  return row !== undefined;
}

/**
 * 그룹의 소유 팀 — groupId 만 받는 표면의 권한 판정용. 없으면 null.
 *
 * **해산된 팀의 그룹은 없는 것으로 본다**(티켓 13). 팀이 archived 가 되면 그 그룹은 아무도
 * 도달할 수 없는 잔여물이고(설문은 이미 전부 미분류로 떨어져 나갔다), 슈퍼어드민만 멤버십
 * 검사를 건너뛰어 이름 변경·삭제가 열려 있었다. 그룹 행 자체는 감사 계보로 남긴다
 * (0090 헤더) — 여기서 막는 것은 쓰기 경로다.
 */
export async function getSurveyGroupTeamId(groupId: string): Promise<string | null> {
  const [row] = await db
    .select({ teamId: surveyGroups.teamId })
    .from(surveyGroups)
    .innerJoin(teams, and(eq(teams.id, surveyGroups.teamId), eq(teams.status, 'active')))
    .where(eq(surveyGroups.id, groupId))
    .limit(1);
  return row?.teamId ?? null;
}

/**
 * 그룹 생성 — 새 그룹은 목록 맨 뒤에 붙는다.
 *
 * order 를 0 으로 두면 이름순으로 아무 데나 끼어들어 보인다. 기존 최대값 +1 은 동시 생성에서
 * 같은 값이 날 수 있지만 정렬 순서는 불변식이 아니라 표시 순서라 그걸로 깨지는 것이 없다
 * (이름 2차 정렬이 받아준다).
 */
export async function createSurveyGroup(
  actorUserId: string,
  input: CreateSurveyGroupInput,
): Promise<CreateSurveyGroupOutput> {
  const team = await db.query.teams.findFirst({
    where: and(eq(teams.id, input.teamId), eq(teams.status, 'active')),
    columns: { id: true },
  });
  if (!team) throw new TeamNotFoundError();

  const [tail] = await db
    .select({ maxOrder: sql<number | null>`max(${surveyGroups.order})` })
    .from(surveyGroups)
    .where(eq(surveyGroups.teamId, input.teamId));

  try {
    const [group] = await db
      .insert(surveyGroups)
      .values({
        teamId: input.teamId,
        name: input.name,
        createdBy: actorUserId,
        order: (tail?.maxOrder ?? -1) + 1,
      })
      .returning({ id: surveyGroups.id });
    if (!group) throw new SurveyGroupNotFoundError();
    return { id: group.id };
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateSurveyGroupNameError();
    throw err;
  }
}

export async function renameSurveyGroup(
  input: RenameSurveyGroupInput,
): Promise<WorkspaceActionOutput> {
  try {
    const [row] = await db
      .update(surveyGroups)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(surveyGroups.id, input.groupId))
      .returning({ id: surveyGroups.id });
    if (!row) throw new SurveyGroupNotFoundError();
    return OK;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateSurveyGroupNameError();
    throw err;
  }
}

/**
 * 정렬 — 화면이 준 순서대로 order 를 0..n-1 로 다시 매긴다.
 *
 * UPDATE 를 teamId 로도 좁히는 것이 팀 경계다: 배열에 타 팀 groupId 가 섞여 들어와도
 * 그 행에는 닿지 않는다(관문이 이미 요청자의 팀을 확인했으므로 조용히 무시해도 안전하다).
 *
 * 팀 키 advisory lock 을 잡는 이유는 lost update 때문이 아니다(순서 값은 표시용이라 덮여도
 * 불변식이 안 깨진다) — **행 잠금 순서가 요청자마다 다르기 때문**이다. 그룹이 팀 공용이라
 * 두 팀원이 같은 목록을 동시에 드래그하는 것이 정상 동선인데, 한쪽은 [g1,g2] 다른 쪽은
 * [g2,g1] 로 UPDATE 하면 서로의 락을 기다려 40P01 데드락이 난다. 그 에러는 도메인 에러가
 * 아니라 500 으로 새어 나간다. 같은 팀의 정렬을 직렬화하면 순서 사이클 자체가 없어진다
 * (members 의 lockTeamMembers 와 같은 관례).
 */
export async function reorderSurveyGroups(
  input: ReorderSurveyGroupsInput,
): Promise<WorkspaceActionOutput> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('survey-groups-' || ${input.teamId}))`,
    );
    for (const [index, groupId] of input.orderedGroupIds.entries()) {
      await tx
        .update(surveyGroups)
        .set({ order: index, updatedAt: new Date() })
        .where(and(eq(surveyGroups.id, groupId), eq(surveyGroups.teamId, input.teamId)));
    }
  });
  return OK;
}

/**
 * 그룹 삭제 — 소속 설문은 미분류로 돌아간다 (FK ON DELETE SET NULL).
 *
 * 설문·응답·공유 설정은 손대지 않는다(.pen FLOW 2-3 의 「그룹만 삭제되고 설문은 삭제되지
 * 않습니다」). 그래서 여기서 설문을 따로 UPDATE 하지 않는다 — DB 가 원자적으로 처리한다.
 */
export async function removeSurveyGroup(groupId: string): Promise<WorkspaceActionOutput> {
  const [row] = await db
    .delete(surveyGroups)
    .where(eq(surveyGroups.id, groupId))
    .returning({ id: surveyGroups.id });
  if (!row) throw new SurveyGroupNotFoundError();
  return OK;
}

/**
 * 「설문 담기」 후보 — 그 팀의 **미분류** 설문 중 **요청자가 볼 수 있는 것만** (.pen FLOW 2-2).
 *
 * 팀 소속이라고 팀의 모든 설문이 보이는 것은 아니다 — `invite_only` 는 소유 팀 팀원에게만
 * 숨긴다(스펙 §3). survey.view 없는 행을 "편집 권한 없음" 으로 그려 남겨두면 제목이 그대로
 * 새어 목록 화면이 숨긴 것을 이 패널이 보여준다. 그래서 **거르는 것이 먼저이고**
 * `canMove` 는 그다음이다.
 *
 * `canMove` 는 근사가 아니라 서버 판정 그대로다: 주체를 한 번 싣고
 * resolveSurveyCapabilities(순수)를 행마다 돌린다. 목록 화면의 canEditSurveyCard 처럼
 * 규칙을 두 벌 쓰면 "선택은 되는데 담기면 거부" 가 생긴다. 요구는 survey.edit +
 * surveyGroup.manage 둘 다다 — 참여자(티켓 18)는 편집권은 있어도 그 팀의 그룹 구조를 만질
 * 자격이 없다. 그 조합이 「볼 수는 있지만 담을 수는 없는」 행을 만든다.
 */
export async function listUngroupedSurveys(input: {
  user: SurveyAccessUser;
  teamId: string;
  query: string;
}): Promise<ListUngroupedSurveysOutput> {
  const rows = await db
    .select({
      id: surveys.id,
      title: surveys.title,
      updatedAt: surveys.updatedAt,
      teamId: surveys.teamId,
      visibility: surveys.visibility,
      ownerUserId: surveys.ownerUserId,
      assignmentStatus: surveys.assignmentStatus,
    })
    .from(surveys)
    .where(
      and(
        eq(surveys.teamId, input.teamId),
        isNull(surveys.surveyGroupId),
        isNull(surveys.deletedAt),
        // `%`·`_` 를 그대로 넘기면 사용자가 친 「50%」가 와일드카드가 되어 검색이 넓어진다.
        input.query.length > 0
          ? ilike(surveys.title, `%${escapeLikePattern(input.query)}%`)
          : undefined,
      ),
    )
    .orderBy(asc(surveys.title));

  const subject = await loadAccessSubject(input.user);
  return rows.flatMap((row) => {
    const caps = resolveSurveyCapabilities(subject, row, null);
    if (!caps.has('survey.view')) return [];
    return [
      {
        id: row.id,
        title: row.title,
        updatedAt: row.updatedAt,
        canMove: caps.has('survey.edit') && caps.has('surveyGroup.manage'),
      },
    ];
  });
}

/**
 * 일괄 담기 — 그룹 행과 대상 설문 행을 모두 잠근 뒤 **잠긴 값으로** 다시 판정한다.
 *
 * 관문이 본 teamId·surveyGroupId 는 판정 시점의 값이다. 그 사이에 다른 담기·단건 이동·팀
 * 해산·재배치가 끼어들면 UPDATE 는 옛 판정을 근거로 강행되어 "미분류만" 불변식과 팀 경계가
 * 함께 깨진다. 잠금 순서는 그룹 → 설문(그 안에서는 id 오름차순)으로 고정한다 —
 * moveSurveyToGroup 과 같은 순서라 두 함수 사이에도 데드락이 생기지 않는다.
 *
 * `updatedAt` 은 손대지 않는다 — 폴더에 넣는 일은 설문 내용을 고치는 일이 아니고, 건드리면
 * 「최신 수정순」 기본 정렬이 담기 한 번에 통째로 뒤집힌다.
 */
export async function collectSurveysIntoGroup(
  input: CollectSurveysIntoGroupInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    const group = await lockGroup(tx, input.groupId);

    const rows = await tx
      .select({ id: surveys.id, surveyGroupId: surveys.surveyGroupId, teamId: surveys.teamId })
      .from(surveys)
      .where(and(inArray(surveys.id, input.surveyIds), isNull(surveys.deletedAt)))
      // 설문들 **사이의** 잠금 순서도 고정한다. ORDER BY 가 없으면 실행 계획이 순서를
      // 정해(건수에 따라 인덱스 스캔 ↔ 비트맵 스캔) 겹치는 집합을 동시에 담는 두 요청의
      // 잠금 순서가 갈리고, 그때 데드락이 성립한다.
      .orderBy(asc(surveys.id))
      .for('update');
    if (rows.length !== input.surveyIds.length) throw new SurveyGroupTargetNotFoundError();

    for (const row of rows) {
      if (row.teamId !== group.teamId) throw new SurveyTeamMismatchError();
      if (row.surveyGroupId !== null) throw new SurveyAlreadyGroupedError();
    }

    await tx
      .update(surveys)
      .set({ surveyGroupId: input.groupId })
      .where(inArray(surveys.id, input.surveyIds));
    return OK;
  });
}

/**
 * 단건 이동 (카드 케밥) — `groupId: null` 은 미분류로 이동(그룹에서 빼기).
 *
 * 그룹을 지정한 경우에만 팀 일치를 본다. 빼기는 목적지가 없으므로 설문 존재 확인이 전부다.
 * 잠금이 필요한 이유는 담기와 같다 — 관문 이후 팀이 바뀌면 팀 경계를 넘는 편입이 된다.
 */
export async function moveSurveyToGroup(
  input: MoveSurveyToGroupInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    const groupTeamId = input.groupId === null ? null : (await lockGroup(tx, input.groupId)).teamId;

    const [survey] = await tx
      .select({ id: surveys.id, teamId: surveys.teamId })
      .from(surveys)
      .where(and(eq(surveys.id, input.surveyId), isNull(surveys.deletedAt)))
      .for('update');
    if (!survey) throw new SurveyGroupTargetNotFoundError();
    if (input.groupId !== null && survey.teamId !== groupTeamId)
      throw new SurveyTeamMismatchError();

    await tx
      .update(surveys)
      .set({ surveyGroupId: input.groupId })
      .where(eq(surveys.id, input.surveyId));
    return OK;
  });
}

/** 그룹 행을 잠그고 소유 팀을 돌려준다 — 담기·이동이 공유하는 첫 단계(잠금 순서 고정). */
async function lockGroup(tx: DbTransaction, groupId: string): Promise<{ teamId: string }> {
  const [group] = await tx
    .select({ id: surveyGroups.id, teamId: surveyGroups.teamId })
    .from(surveyGroups)
    .where(eq(surveyGroups.id, groupId))
    .for('update');
  if (!group) throw new SurveyGroupNotFoundError();
  return { teamId: group.teamId };
}
