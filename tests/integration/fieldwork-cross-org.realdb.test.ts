/**
 * 실사 cross-org — 업체 경계 밖 설문 id 를 넣으면 어떻게 되는가 (티켓 28, D 검증 게이트) — 실 로컬 DB.
 *
 * 게스트의 짝(`guest-cross-survey.realdb.test.ts`)과 같은 자리지만 **묻는 것이 하나 더
 * 많다**. 게스트의 자격은 「내게 부여됐는가」 하나라 축이 둘(부여/미부여)이지만, 실사에는
 * 파생 시야가 있어 **내 초대 없이도 열리는 설문**이 존재한다 — 자기 업체 소속원이 초대된
 * 설문이다(ADR-0019). 그래서 「안 열림」이 두 가지 이유로 갈린다:
 *
 *  - **타 업체** 설문 → 업체 경계 밖. 팀장에게도 NOT_FOUND 여야 한다.
 *  - **내 업체지만 아무도 초대 안 된** 설문 → 파생 시야의 원천이 없다. 역시 NOT_FOUND.
 *
 * 이 둘이 갈리지 않으면 실사 팀장 계정 하나로 설문 id 를 훑어 **경쟁 업체가 무엇을 맡고
 * 있는지**를 확인할 수 있다. 데이터가 새지 않아도 그 자체가 협력사에게 우리 수주 목록을
 * 여는 것이다 — 업체 경계를 둔 이유가 정확히 그것이다(티켓 24).
 *
 * 실 DB 인 이유는 게스트 스위트와 같되 더 무겁다: 파생 시야는 **참여 행 밖의 EXISTS**(주체의
 * 업체 ↔ 소속원의 초대)라, 목의 `rowsFor` 로는 그 조인 조건이 있든 없든 결과가 같다.
 * **업체를 둘 심는 것이 뼈대다** — 하나뿐인 시드에서는 조인 조건을 지워도 초록이다.
 *
 * 대상은 **scoped 베이스 전수**이고 목록은 게스트 스위트와 공유한다
 * (`tests/helpers/scoped-surface-inputs`). 각자 표를 들면 새 표면이 붙었을 때 한쪽만
 * 빨개진다. authed·superadmin 전수는 `fieldwork-account-denial.test.ts` 소관이고,
 * 초대 설문에서 무엇이 열리는가는 그 파일과 `capability-matrix-spec` 이 이미 고정한다.
 */
import { createRouterClient } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  contactTargets as contactTargetsTable,
  fieldworkOrgs as orgsTable,
  mailCampaigns as mailCampaignsTable,
  mailTemplates as mailTemplatesTable,
  surveyParticipants as participantsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import { router } from '@/server/router';
import { loadSurveyCapabilities } from '@/server/survey-access';
import { SCOPED_INPUTS, SCOPED_PATHS } from '@tests/helpers/scoped-surface-inputs';
import { enumerateProcedures } from '@tests/helpers/rpc-surface';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const RUN = crypto.randomUUID().slice(0, 8);

const OWNER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();

/** 우리 업체 — 팀장과 소속원 하나씩. */
const ORG_ID = crypto.randomUUID();
const LEADER_ID = crypto.randomUUID();
const WORKER_ID = crypto.randomUUID();
/** 같은 업체의 **다른** 실사원 — 「동료의 초대는 내 자격이 아니다」를 물으려면 필요하다. */
const PEER_ID = crypto.randomUUID();

/** 경쟁 업체 — 여기 사람이 초대된 설문이 우리에게 보이면 안 된다. */
const RIVAL_ORG_ID = crypto.randomUUID();
const RIVAL_WORKER_ID = crypto.randomUUID();

const FIELDWORK_IDS = [LEADER_ID, WORKER_ID, PEER_ID, RIVAL_WORKER_ID];

/**
 * 내 초대 설문 / **동료만** 초대(팀장에게만 파생 시야) / 타 업체 초대 / 아무도 초대 안 됨.
 *
 * `colleagueId` 에 WORKER 를 넣으면 안 된다 — 그러면 그 설문은 WORKER 의 **자기 초대**라
 * 「동료의 초대는 내 자격이 아니다」를 묻는 축이 통째로 사라진다.
 */
let mineId = '';
let colleagueId = '';
let rivalId = '';
let idleId = '';

function contextFor(userId: string): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `fw-cross-${userId}@example.com`,
      name: '실사테스터',
      status: 'active',
      isSuperadmin: false,
      userType: 'fieldwork',
    },
    headers: new Headers({ 'x-real-ip': '203.0.113.31' }),
  };
}

function callerFor(userId: string, path: string): (input: unknown) => Promise<unknown> {
  const client = createRouterClient(router, { context: contextFor(userId) });
  const fn = path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], client as unknown);
  if (typeof fn !== 'function') throw new Error(`호출할 수 없는 경로: ${path}`);
  return fn as (input: unknown) => Promise<unknown>;
}

async function seedUser(
  id: string,
  over: { userType?: 'internal' | 'fieldwork'; role?: 'leader' | 'worker'; orgId?: string } = {},
): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `fw-cross-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin: false,
    userType: over.userType ?? 'internal',
    ...(over.userType === 'fieldwork'
      ? { fieldworkOrgId: over.orgId ?? ORG_ID, fieldworkRole: over.role ?? 'worker' }
      : {}),
  });
}

async function seedSurvey(title: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id,
    title,
    teamId: TEAM_ID,
    assignmentStatus: 'assigned',
    visibility: 'team',
    ownerUserId: OWNER_ID,
    createdBy: OWNER_ID,
  });
  return id;
}

async function invite(surveyId: string, userId: string): Promise<void> {
  await db
    .insert(participantsTable)
    .values({ surveyId, userId, kind: 'fieldwork', addedBy: OWNER_ID });
}

describe.skipIf(!isLocalDb)('실사 cross-org (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(OWNER_ID);
    await db.insert(orgsTable).values([
      { id: ORG_ID, name: `우리업체-${RUN}`, createdBy: OWNER_ID },
      { id: RIVAL_ORG_ID, name: `경쟁업체-${RUN}`, createdBy: OWNER_ID },
    ]);
    await seedUser(LEADER_ID, { userType: 'fieldwork', role: 'leader' });
    await seedUser(WORKER_ID, { userType: 'fieldwork', role: 'worker' });
    await seedUser(PEER_ID, { userType: 'fieldwork', role: 'worker' });
    await seedUser(RIVAL_WORKER_ID, {
      userType: 'fieldwork',
      role: 'worker',
      orgId: RIVAL_ORG_ID,
    });
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `실사교차팀-${RUN}` });
    await db.insert(teamMembersTable).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'member' });

    mineId = await seedSurvey('내 초대 설문');
    colleagueId = await seedSurvey('소속원만 초대된 설문');
    rivalId = await seedSurvey('경쟁 업체가 맡은 설문');
    idleId = await seedSurvey('아무도 초대되지 않은 설문');

    await invite(mineId, LEADER_ID);
    await invite(mineId, WORKER_ID);
    await invite(colleagueId, PEER_ID);
    await invite(rivalId, RIVAL_WORKER_ID);
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    const all = [mineId, colleagueId, rivalId, idleId].filter(Boolean);
    if (all.length > 0) await db.delete(surveysTable).where(inArray(surveysTable.id, all));
    await db.delete(teamMembersTable).where(eq(teamMembersTable.userId, OWNER_ID));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(inArray(usersTable.id, FIELDWORK_IDS));
    await db.delete(orgsTable).where(inArray(orgsTable.id, [ORG_ID, RIVAL_ORG_ID]));
    await db.delete(usersTable).where(eq(usersTable.id, OWNER_ID));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 목록의 출처는 라우터다
  // ───────────────────────────────────────────────────────────────────────────

  it('scoped 표면 전수가 공용 인벤토리와 같다', () => {
    // 게스트 스위트와 **같은 표**를 본다. 각자 들면 새 scoped procedure 가 붙었을 때
    // 한쪽만 빨개지고 다른 쪽은 검증 밖으로 조용히 빠진다.
    const enumerated = enumerateProcedures()
      .filter((p) => p.base === 'scoped')
      .map((p) => p.path)
      .sort();
    expect(enumerated).toEqual(SCOPED_PATHS);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 업체 경계 — 경쟁 업체가 맡은 설문은 존재조차 알리지 않는다
  // ───────────────────────────────────────────────────────────────────────────

  describe('타 업체가 초대된 설문 — 팀장에게도 NOT_FOUND', () => {
    it.each(SCOPED_PATHS)('%s 는 경쟁 업체의 수주를 비치지 않는다', async (path) => {
      // 파생 시야의 EXISTS 는 **업체**로 조인한다. 그 조건을 빼면 「누군가 초대된 설문」이
      // 전부 팀장 시야에 들어와, 경쟁 업체가 무엇을 맡았는지가 id 스캔으로 드러난다.
      await expect(
        callerFor(LEADER_ID, path)({ surveyId: rivalId, ...SCOPED_INPUTS[path] }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('아무도 초대되지 않은 설문 — NOT_FOUND', () => {
    it.each(SCOPED_PATHS)('%s 는 파생 시야의 원천이 없으면 닫힌다', async (path) => {
      await expect(
        callerFor(LEADER_ID, path)({ surveyId: idleId, ...SCOPED_INPUTS[path] }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('소속원만 초대된 설문 — 실사원에게는 NOT_FOUND', () => {
    it.each(SCOPED_PATHS)('%s 는 실사원에게 열리지 않는다', async (path) => {
      // 파생 시야는 **팀장에게만** 켜진다. 실사원에게도 켜지면 업체 안에서 서로의 담당
      // 설문이 전부 보이고, 「초대는 개인 단위」가 이름뿐이 된다.
      await expect(
        callerFor(WORKER_ID, path)({ surveyId: colleagueId, ...SCOPED_INPUTS[path] }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 사유의 대비 — 팀장의 파생 시야는 「없다」가 아니라 「권한이 없다」
  // ───────────────────────────────────────────────────────────────────────────

  it('팀장에게 소속원 초대 설문은 존재한다 — 거부 사유가 NOT_FOUND 가 아니다', async () => {
    // 이 대비가 이 파일의 요점이다. 같은 「거부」라도 타 업체는 존재를 숨기고 내 업체는
    // 권한 부족을 말해야 한다 — 갈리지 않으면 파생 시야가 아무것도 아니게 되거나,
    // 반대로 업체 경계가 아무것도 아니게 된다.
    await expect(
      callerFor(LEADER_ID, 'contacts.attempts.add')({
        surveyId: colleagueId,
        ...SCOPED_INPUTS['contacts.attempts.add'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const caps = [...(await loadSurveyCapabilities(
      { id: LEADER_ID, isSuperadmin: false, userType: 'fieldwork' },
      colleagueId,
    ))];
    expect(caps).toContain('contacts.view');
    expect(caps).not.toContain('contacts.writeAttempts');
  });

  it('타 업체 설문에서는 capability 가 하나도 서지 않는다', async () => {
    const caps = [...(await loadSurveyCapabilities(
      { id: LEADER_ID, isSuperadmin: false, userType: 'fieldwork' },
      rivalId,
    ))];
    expect(caps).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 거부는 값이 아니라 사실이어야 한다
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 위 셋은 **예외의 코드**만 본다. 관문이 서비스 뒤로 밀려 「쓰고 나서 거부」가 되어도
   * 코드는 같을 수 있다. 그래서 세 설문에 딸린 행이 하나도 생기지 않았음을 마지막에 센다.
   */
  it('경계 밖 설문 어디에도 컨택·템플릿·캠페인이 생기지 않았다', async () => {
    const surveyIds = [rivalId, idleId, colleagueId];
    const [contacts, templates, campaigns] = await Promise.all([
      db
        .select({ id: contactTargetsTable.id })
        .from(contactTargetsTable)
        .where(inArray(contactTargetsTable.surveyId, surveyIds)),
      db
        .select({ id: mailTemplatesTable.id })
        .from(mailTemplatesTable)
        .where(inArray(mailTemplatesTable.surveyId, surveyIds)),
      db
        .select({ id: mailCampaignsTable.id })
        .from(mailCampaignsTable)
        .where(inArray(mailCampaignsTable.surveyId, surveyIds)),
    ]);
    expect({
      contacts: contacts.length,
      templates: templates.length,
      campaigns: campaigns.length,
    }).toEqual({ contacts: 0, templates: 0, campaigns: 0 });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑤ 계정 열거 — 업체 명부는 실사에게 닫혀 있다
  // ───────────────────────────────────────────────────────────────────────────

  it('실사는 업체 목록·계정 명부를 열 수 없다 — 협력사 명부다', async () => {
    // 업체 관리 5종은 superadmin 베이스라 유형에서 막힌다(티켓 24). 여기서 다시 묻는 것은
    // 그 사실이 **실사 계정으로** 참인지다 — 베이스가 바뀌면 이 자리가 먼저 빨개진다.
    for (const userId of [LEADER_ID, WORKER_ID]) {
      const client = createRouterClient(router, { context: contextFor(userId) });
      await expect(client.workspace.fieldworkOrgs.list({})).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(client.workspace.fieldworkOrgs.options()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
  });

  it('초대 표면도 실사에게 닫혀 있다 — 초대받은 사람이 남을 초대하지 못한다', async () => {
    const client = createRouterClient(router, { context: contextFor(LEADER_ID) });
    await expect(
      client.workspace.fieldwork.searchCandidates({ surveyId: mineId, query: '' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      client.workspace.fieldwork.list({ surveyId: mineId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑥ 초대 행은 업체를 가로지르지 않는다
  // ───────────────────────────────────────────────────────────────────────────

  it('경쟁 업체의 초대 행은 우리 업체 누구의 자격도 되지 않는다', async () => {
    const rows = await db
      .select({ userId: participantsTable.userId })
      .from(participantsTable)
      .where(and(eq(participantsTable.surveyId, rivalId), eq(participantsTable.kind, 'fieldwork')));
    // 시드가 의도대로인지 먼저 본다 — 초대 행이 없으면 위 NOT_FOUND 들이 공허하게 통과한다.
    expect(rows.map((r) => r.userId)).toEqual([RIVAL_WORKER_ID]);

    for (const userId of [LEADER_ID, WORKER_ID]) {
      const caps = [...(await loadSurveyCapabilities(
        { id: userId, isSuperadmin: false, userType: 'fieldwork' },
        rivalId,
      ))];
      expect(caps).toEqual([]);
    }
  });
});
