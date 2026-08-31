/**
 * 게스트 cross-survey — 부여받지 않은 설문 id 를 넣으면 어떻게 되는가 (티켓 23, C 검증 게이트) — 실 로컬 DB.
 *
 * 티켓 21 의 음성 스위트(`guest-account-denial.test.ts`)는 **부여된 설문**에서 무엇이 닫혀
 * 있는지를 물었고, 그 파일 끝에 이 축을 넘겨 뒀다: 「부여되지 않은 설문은 존재조차 알리지
 * 않는다」는 목으로 증명할 수 없다 — 목의 `rowsFor` 는 WHERE 를 모르므로 어떤 id 를 넣어도
 * 같은 행을 돌려주고, 판정 로더의 LEFT JOIN 이 정말 null 이 되는지가 보이지 않는다.
 *
 * 그래서 실 DB 에서 **사유의 대비**로 묻는다. 게스트가 게이트 밖 설문을 지목했을 때
 *  - 부여된 설문   → FORBIDDEN (보이지만 그 작업 권한이 없다)
 *  - 미부여 설문   → NOT_FOUND (존재를 알리지 않는다)
 *  - 남의 부여 설문 → NOT_FOUND (같은 팀·같은 소유자여도 마찬가지)
 * 이 갈림이 없으면 게스트 계정 하나로 id 를 훑어 「어느 설문이 존재하는가」를 확인할 수
 * 있다. 둘 다 거부라 데이터는 안 새지만, 그 자체가 고객사에게 우리 조사 목록을 여는 것이다.
 *
 * 대상은 **scoped 베이스 전수**다 — 게스트를 통과시키는 유일한 문이고(나머지는 베이스가
 * 유형으로 막는다: guest-account-denial 이 authed·superadmin 전수를 본다), 목록의 출처는
 * 라우터다. 아래 인벤토리와 라우터 열거가 어긋나면 그 자리에서 빨개진다.
 *
 * REST 축(export 3종)은 여기 없다 — 게스트는 `requireAuth` 의 유형 게이트에서 401 이라
 * 설문 id 를 볼 기회조차 없고, 그 축은 `tests/unit/api/export-route-auth.test.ts` 가 진다.
 * 화면 축(게스트 콘솔 주소)은 `guest-console.realdb.test.ts` 의 탭 관문 블록이 진다.
 */
import { createRouterClient } from '@orpc/server';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  contactTargets as contactTargetsTable,
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
import { enumerateProcedures } from '@tests/helpers/rpc-surface';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const OWNER_ID = crypto.randomUUID();
const GUEST_ID = crypto.randomUUID();
const OTHER_GUEST_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();

const ALL_USER_IDS = [OWNER_ID, GUEST_ID, OTHER_GUEST_ID];

/** 이 게스트에게 부여된 설문. */
let grantedId = '';
/** 아무에게도 부여되지 않은 설문 — 같은 팀·같은 소유자다. */
let ungrantedId = '';
/** 다른 게스트에게 부여된 설문 — 부여가 존재한다는 사실도 알려지면 안 된다. */
let foreignGrantId = '';

/** 하위 행 id — 설문 관문이 먼저 서므로 어느 것도 읽히면 안 된다. */
const CHILD_ID = crypto.randomUUID();

function guestContext(userId: string): ORPCContext {
  return {
    db: {} as never,
    user: {
      id: userId,
      email: `guest-cross-${userId}@client.example.com`,
      name: '클라이언트',
      status: 'active',
      // 비내부 계정에 이 플래그가 실려 와도 열리면 안 된다 — 가장 불리한 조건에서 묻는다.
      isSuperadmin: true,
      userType: 'guest',
    },
    headers: new Headers(),
  };
}

const client = createRouterClient(router, { context: guestContext(GUEST_ID) });

function callerFor(path: string): (input: unknown) => Promise<unknown> {
  const fn = path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], client as unknown);
  if (typeof fn !== 'function') throw new Error(`호출할 수 없는 경로: ${path}`);
  return fn as (input: unknown) => Promise<unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 인벤토리 — scoped 표면 전수와 그 최소 입력
// ─────────────────────────────────────────────────────────────────────────────

/** 메일 템플릿 입력의 필수 칸 — 발신 표기까지 전부 요구된다. */
const MAIL_TEMPLATE_INPUT = {
  name: '주입 템플릿',
  subject: '주입',
  bodyHtml: '<p>주입</p>',
  fromLocal: 'no-reply',
  fromName: '메가리서치',
  replyTo: 'ops@megaresearch.co.kr',
};

/**
 * 표면 → 설문 id 를 뺀 최소 입력.
 *
 * 관문이 handler 첫 줄이라 그 뒤 값은 읽히지 않는다 — zod 검증만 통과하면 된다. 하위
 * id 는 **존재하지 않는 uuid** 를 넣는다: 관문이 서면 하위 id 가 무엇이든 거기서 멈춰야
 * 하고, 실재하는 행을 넣으면 「없어서 막힌 것」과 구별되지 않는다.
 */
const SCOPED_INPUTS: Record<string, Record<string, unknown>> = {
  'contacts.targets.add': { attrs: {} },
  'contacts.targets.update': { id: CHILD_ID, attrs: {} },
  'contacts.attempts.add': { contactTargetId: CHILD_ID, resultCode: 'x' },
  'contacts.attempts.update': { contactTargetId: CHILD_ID, id: CHILD_ID, resultCode: 'x' },
  'contacts.attempts.remove': { contactTargetId: CHILD_ID, id: CHILD_ID },
  'contacts.attrValues.list': { attrsKey: 'k' },
  'mail.templates.create': { input: MAIL_TEMPLATE_INPUT },
  'mail.templates.update': { templateId: CHILD_ID, input: MAIL_TEMPLATE_INPUT },
  'mail.templates.remove': { templateId: CHILD_ID },
  'mail.preview.sample': { contactTargetId: CHILD_ID },
  'mail.preview.testSend': {
    to: 'ops@megaresearch.co.kr',
    subject: '주입',
    bodyHtml: '<p>주입</p>',
    fromName: '메가리서치',
    fromLocal: 'no-reply',
    replyTo: 'ops@megaresearch.co.kr',
  },
  'mail.campaigns.create': { mailTemplateId: CHILD_ID, title: 'x', contactTargetIds: [CHILD_ID] },
  'mail.campaigns.cancel': { campaignId: CHILD_ID },
  'mail.campaigns.resync': { campaignId: CHILD_ID },
  'mail.campaigns.fetchCandidateIds': { filter: {} },
  'mail.campaigns.previewPreflight': { selectedContactIds: [CHILD_ID] },
  'mail.campaigns.sendSingle': { contactTargetId: CHILD_ID, mailTemplateId: CHILD_ID },
  'surveyResponse.edit.saveAdminEdit': {
    responseId: CHILD_ID,
    questionResponses: {},
    versionId: CHILD_ID,
  },
};

const SCOPED_PATHS = Object.keys(SCOPED_INPUTS).sort();

// ─────────────────────────────────────────────────────────────────────────────
// 시드
// ─────────────────────────────────────────────────────────────────────────────

async function seedUser(id: string, userType: 'internal' | 'guest'): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `guest-cross-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin: false,
    userType,
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

describe.skipIf(!isLocalDb)('게스트 cross-survey (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(OWNER_ID, 'internal');
    await seedUser(GUEST_ID, 'guest');
    await seedUser(OTHER_GUEST_ID, 'guest');
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `게스트교차팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembersTable).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'member' });

    grantedId = await seedSurvey('부여된 조사');
    ungrantedId = await seedSurvey('부여되지 않은 조사');
    foreignGrantId = await seedSurvey('다른 게스트의 조사');

    await db.insert(participantsTable).values([
      { surveyId: grantedId, userId: GUEST_ID, kind: 'guest', addedBy: OWNER_ID },
      { surveyId: foreignGrantId, userId: OTHER_GUEST_ID, kind: 'guest', addedBy: OWNER_ID },
    ]);
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    const all = [grantedId, ungrantedId, foreignGrantId].filter(Boolean);
    if (all.length > 0) await db.delete(surveysTable).where(inArray(surveysTable.id, all));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, ALL_USER_IDS));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(inArray(usersTable.id, ALL_USER_IDS));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 목록의 출처는 라우터다
  // ───────────────────────────────────────────────────────────────────────────

  it('scoped 표면 전수가 인벤토리에 등재돼 있다', () => {
    // 손으로 적은 목록만 돌면 새로 붙은 scoped procedure 는 영원히 초록이다. scoped 는
    // 게스트를 통과시키는 유일한 베이스라 여기 빠진 표면이 곧 검증되지 않는 문이다.
    const enumerated = enumerateProcedures()
      .filter((p) => p.base === 'scoped')
      .map((p) => p.path)
      .sort();
    expect(enumerated).toEqual(SCOPED_PATHS);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 사유의 대비 — 거부는 같아도 말하는 것이 다르다
  // ───────────────────────────────────────────────────────────────────────────

  describe('부여된 설문 — FORBIDDEN', () => {
    it.each(SCOPED_PATHS)('%s 는 권한 부족으로 막힌다', async (path) => {
      // 존재는 이미 알고 있다(부여받았으니까) — 여기서 NOT_FOUND 가 나오면 게스트 콘솔이
      // 자기 설문을 「없는 것」으로 보게 된다.
      await expect(
        callerFor(path)({ surveyId: grantedId, ...SCOPED_INPUTS[path] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('부여되지 않은 설문 — NOT_FOUND', () => {
    it.each(SCOPED_PATHS)('%s 는 존재를 알리지 않는다', async (path) => {
      await expect(
        callerFor(path)({ surveyId: ungrantedId, ...SCOPED_INPUTS[path] }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('다른 게스트에게 부여된 설문 — NOT_FOUND', () => {
    it.each(SCOPED_PATHS)('%s 는 남의 부여를 비치지 않는다', async (path) => {
      // 판정 로더는 참여 행을 **주체 id 와 함께** 조인한다. 설문 id 만으로 조인하면 남의
      // 부여가 내 자격이 되어, 한 사람에게 부여된 설문이 전 고객사에게 열린다.
      await expect(
        callerFor(path)({ surveyId: foreignGrantId, ...SCOPED_INPUTS[path] }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 거부는 값이 아니라 사실이어야 한다
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 위 셋은 **예외의 코드**만 본다. 관문이 서비스 뒤로 밀려 「쓰고 나서 거부」가 되어도
   * 코드는 같을 수 있다 — 실제로 쓰기 표면이 아홉이라 그 창이 좁지 않다.
   *
   * 그래서 세 설문에 딸린 행이 **하나도 생기지 않았음**을 마지막에 한 번 센다. 목이었다면
   * 셀 것이 없어 이 단언 자체가 성립하지 않는다(그것이 이 파일이 realdb 인 이유의 절반이다).
   */
  it('어느 설문에도 컨택·템플릿·캠페인이 생기지 않았다', async () => {
    const surveyIds = [grantedId, ungrantedId, foreignGrantId];

    const contacts = await db
      .select({ id: contactTargetsTable.id })
      .from(contactTargetsTable)
      .where(inArray(contactTargetsTable.surveyId, surveyIds));
    const templates = await db
      .select({ id: mailTemplatesTable.id })
      .from(mailTemplatesTable)
      .where(inArray(mailTemplatesTable.surveyId, surveyIds));
    const campaigns = await db
      .select({ id: mailCampaignsTable.id })
      .from(mailCampaignsTable)
      .where(inArray(mailCampaignsTable.surveyId, surveyIds));

    expect({
      contacts: contacts.length,
      templates: templates.length,
      campaigns: campaigns.length,
    }).toEqual({ contacts: 0, templates: 0, campaigns: 0 });
  });
});
