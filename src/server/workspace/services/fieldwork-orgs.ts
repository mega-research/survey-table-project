import 'server-only';

import { and, asc, count, countDistinct, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import { fieldworkOrgs, surveyParticipants, users } from '@/db/schema';
import { isUniqueViolation } from '@/lib/pg-error';

import {
  type ArchiveFieldworkOrgInput,
  type CreateFieldworkOrgInput,
  type CreateFieldworkOrgOutput,
  DuplicateFieldworkOrgNameError,
  type FieldworkOrgAccountItem,
  FieldworkOrgHasActiveAccountsError,
  FieldworkOrgNotFoundError,
  type ListFieldworkOrgOptionsOutput,
  type ListFieldworkOrgsOutput,
  type UpdateFieldworkOrgInput,
  type WorkspaceActionOutput,
} from '../domain/fieldwork-orgs';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 실사 업체 목록 (.pen FLOW 10-4) — 활성 업체 + 소속 계정 명단.
 *
 * 계정을 **행에 실어 함께 준다**. 협력 업체는 ~5곳이고 카드를 펼치면 곧바로 명단을 그리므로
 * (.pen 10-4) 카드마다 두 번째 왕복을 만들 이유가 없다.
 *
 * 카운트 셋은 각각 모집단이 다르다.
 *  - 역할별 인원(leader·worker)은 **재직 중만** 센다 — 카드 부제가 「지금 몇 명이 뛰는가」다.
 *  - 초대된 설문 수는 **업체 단위 distinct** 다. 초대는 개인 단위지만(ADR-0019) 한 설문에 두
 *    사람이 초대돼 있어도 카드에는 1건이어야 한다.
 *  - 계정 명단은 상태를 가리지 않는다 — 정지·퇴사한 사람도 표식과 함께 보여야 「왜 인원이
 *    줄었는가」를 되짚을 수 있다(팀 상세와 같은 판단).
 */
export async function listFieldworkOrgs(): Promise<ListFieldworkOrgsOutput> {
  const orgs = await db
    .select({
      id: fieldworkOrgs.id,
      name: fieldworkOrgs.name,
      status: fieldworkOrgs.status,
      memo: fieldworkOrgs.memo,
    })
    .from(fieldworkOrgs)
    .where(eq(fieldworkOrgs.status, 'active'))
    .orderBy(asc(fieldworkOrgs.name));

  if (orgs.length === 0) return { orgs: [] };

  const orgIds = orgs.map((org) => org.id);

  const [accountRows, invitedRows] = await Promise.all([
    db
      .select({
        orgId: users.fieldworkOrgId,
        id: users.id,
        name: users.name,
        email: users.email,
        fieldworkRole: users.fieldworkRole,
        status: users.status,
      })
      .from(users)
      .where(inArray(users.fieldworkOrgId, orgIds))
      // 팀장을 위에 세운다 — 카드의 첫 줄이 누구에게 물어야 하는지를 알려준다.
      // 역할 문자열의 사전순에 기대지 않는다(팀 상세와 같은 관례).
      .orderBy(
        sql`case when ${users.fieldworkRole} = 'leader' then 0 else 1 end`,
        asc(users.name),
      ),
    // 초대 표면은 티켓 25 다 — 지금은 늘 0 이지만 쿼리를 미리 세워 두면 그 티켓이 자리만 채운다.
    db
      .select({
        orgId: users.fieldworkOrgId,
        value: countDistinct(surveyParticipants.surveyId),
      })
      .from(surveyParticipants)
      .innerJoin(users, eq(users.id, surveyParticipants.userId))
      .where(
        and(eq(surveyParticipants.kind, 'fieldwork'), inArray(users.fieldworkOrgId, orgIds)),
      )
      .groupBy(users.fieldworkOrgId),
  ]);

  const accountsByOrg = new Map<string, FieldworkOrgAccountItem[]>();
  const leaderCounts = new Map<string, number>();
  const workerCounts = new Map<string, number>();

  for (const row of accountRows) {
    // 조회 조건이 이미 걸러내지만 타입상 nullable 이다 — CHECK 가 보장하는 것을 코드가
    // 다시 주장하지 않고 그냥 건너뛴다.
    if (row.orgId === null || row.fieldworkRole === null) continue;
    const list = accountsByOrg.get(row.orgId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      email: row.email,
      fieldworkRole: row.fieldworkRole,
      status: row.status,
    });
    accountsByOrg.set(row.orgId, list);
    if (row.status !== 'active') continue;
    const counts = row.fieldworkRole === 'leader' ? leaderCounts : workerCounts;
    counts.set(row.orgId, (counts.get(row.orgId) ?? 0) + 1);
  }

  const invitedByOrg = new Map(
    invitedRows.filter((r) => r.orgId !== null).map((r) => [r.orgId as string, r.value]),
  );

  return {
    orgs: orgs.map((org) => ({
      ...org,
      leaderCount: leaderCounts.get(org.id) ?? 0,
      workerCount: workerCounts.get(org.id) ?? 0,
      invitedSurveyCount: invitedByOrg.get(org.id) ?? 0,
      accounts: accountsByOrg.get(org.id) ?? [],
    })),
  };
}

/**
 * 계정 발급 모달의 소속 업체 선택지 — 활성 업체 이름만.
 *
 * 목록(listFieldworkOrgs)을 재사용하지 않는다. 저 표면은 계정 명단·초대 수까지 실어 오는데
 * 셀렉트가 필요한 것은 id·이름뿐이라, 모달을 열 때마다 전 업체의 계정 명부를 끌어오게 된다.
 */
export async function listFieldworkOrgOptions(): Promise<ListFieldworkOrgOptionsOutput> {
  return db
    .select({ id: fieldworkOrgs.id, name: fieldworkOrgs.name })
    .from(fieldworkOrgs)
    .where(eq(fieldworkOrgs.status, 'active'))
    .orderBy(asc(fieldworkOrgs.name));
}

/** 업체 생성 (슈퍼어드민). 이름 충돌은 활성 부분 UNIQUE 가 잡는다. */
export async function createFieldworkOrg(
  actorUserId: string,
  input: CreateFieldworkOrgInput,
): Promise<CreateFieldworkOrgOutput> {
  try {
    const [org] = await db
      .insert(fieldworkOrgs)
      .values({ name: input.name, memo: input.memo, createdBy: actorUserId })
      .returning({ id: fieldworkOrgs.id });
    if (!org) throw new Error('createFieldworkOrg: 업체 생성 실패');
    return { id: org.id };
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateFieldworkOrgNameError();
    throw err;
  }
}

/**
 * 업체 이름·메모 수정 (슈퍼어드민).
 *
 * WHERE 에 `status='active'` 를 함께 건다 — 종료된 업체의 이름은 계보다. 조건이 없으면
 * 목록을 띄워둔 사이 커밋된 종료를 못 보고 archived 행의 이름을 바꾼다(renameTeam 과 같은 판단).
 */
export async function updateFieldworkOrg(
  input: UpdateFieldworkOrgInput,
): Promise<WorkspaceActionOutput> {
  try {
    const [updated] = await db
      .update(fieldworkOrgs)
      .set({ name: input.name, memo: input.memo, updatedAt: new Date() })
      .where(and(eq(fieldworkOrgs.id, input.orgId), eq(fieldworkOrgs.status, 'active')))
      .returning({ id: fieldworkOrgs.id });
    if (!updated) throw new FieldworkOrgNotFoundError();
    return OK;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateFieldworkOrgNameError();
    throw err;
  }
}

/**
 * 업체 종료 — archived 전환 (슈퍼어드민).
 *
 * **재직 중 계정이 하나라도 있으면 거부한다**(FieldworkOrgHasActiveAccountsError 주석 참조).
 * 확인은 업체 행을 `FOR UPDATE` 로 잡은 뒤에 한다 — 잠그지 않으면 계정 수를 0으로 읽은 뒤
 * 계정 발급이 커밋되는 창에서, 방금 발급된 실사원이 종료된 업체 소속으로 남는다.
 * 발급 경로(createUser)가 같은 행을 `FOR SHARE` 로 잡으므로 그 창이 실제로 닫힌다.
 *
 * **종료 취소 procedure 를 만들지 말 것** — 팀 해산과 같은 이유다(ADR-0011). 되돌리기가
 * 있으면 확인 모달의 문구가 거짓이 되고, 잘못 종료했다면 같은 이름으로 다시 만들면 된다
 * (활성 이름만 유일하므로 이름이 비어 있다).
 */
export async function archiveFieldworkOrg(
  actorUserId: string,
  input: ArchiveFieldworkOrgInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: fieldworkOrgs.id })
      .from(fieldworkOrgs)
      .where(and(eq(fieldworkOrgs.id, input.orgId), eq(fieldworkOrgs.status, 'active')))
      .for('update');
    if (!org) throw new FieldworkOrgNotFoundError();

    const [activeRow] = await tx
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.fieldworkOrgId, org.id), eq(users.status, 'active')));
    const activeCount = activeRow?.value ?? 0;
    if (activeCount > 0) throw new FieldworkOrgHasActiveAccountsError(activeCount);

    await tx
      .update(fieldworkOrgs)
      .set({
        status: 'archived',
        archivedBy: actorUserId,
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(fieldworkOrgs.id, org.id));

    return OK;
  });
}
