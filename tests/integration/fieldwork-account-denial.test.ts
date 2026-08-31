/**
 * 실사 계정 음성 스위트 — 초대된 설문에서도 무엇이 닫혀 있는가 (역할 모델 v2 티켓 25).
 *
 * 게스트 쪽 짝(`guest-account-denial.test.ts`)과 같은 구조지만 **실사가 더 급하다.**
 * 실사는 `contacts.view`·`contacts.writeAttempts` 로 **scoped 표면이 실제로 열린 첫 비내부
 * 유형**이다. 게스트는 scoped 베이스를 지나되 요구 capability 를 하나도 갖지 않아 전부
 * 거부됐지만, 실사는 그 중 일부를 통과한다 — 그래서 「어디까지 열렸는가」의 경계가 처음으로
 * 어휘 전수로 확인돼야 하는 유형이다.
 *
 * 묻는 것은 셋이다.
 *  ① **내부 표면은 초대와 무관하게 전부 닫혀 있는가.** 라우터를 런타임에 열거해
 *     authed·superadmin 표면 전수를 실사 컨텍스트로 두드린다 — 목록의 출처가 라우터라
 *     새 procedure 가 붙으면 저절로 검사 대상이 된다.
 *  ② **초대된 설문에서 열리는 capability 가 정확히 넷인가.** 나머지 어휘 전부에 대해
 *     관문이 거부해야 한다.
 *  ③ **팀장의 파생 시야는 그보다 하나 좁은가.** 결과코드 쓰기 한 칸이 그 차이의 전부다.
 *
 * ①이 중간에 서비스로 새는 것은 db 목이 잡는다 — 관문이 없으면 「관문을 지나 DB 에 닿았다」
 * 가 그대로 실패 메시지로 나온다.
 *
 * REST 표면(export 3종)은 라우터에 없어 여기서 열거되지 않는다 —
 * `tests/unit/api/export-route-auth.test.ts` 가 fieldwork 계정을 포함해 같은 축을 진다.
 *
 * 「초대되지 않은 설문은 존재조차 알리지 않는다」는 여기서 묻지 않는다 — 목의 rowsFor 는
 * WHERE 를 모르고 어떤 id 에도 같은 행을 돌려준다. 그 축과 업체 경계는
 * `fieldwork-invites.realdb.test.ts` 가 진다.
 */
import { createRouterClient } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';

import { router } from '@/server/router';
import {
  assertSurveyCapability,
  loadSurveyAccess,
  SurveyAccessError,
} from '@/server/survey-access';
import { surveyCapabilityValues, type SurveyCapability } from '@/shared/contracts/workspace';
import { guestActorContext } from '@tests/helpers/rpc-context';
import { enumerateProcedures } from '@tests/helpers/rpc-surface';

const IDS = vi.hoisted(() => ({
  WORKER_ID: '5c000000-0000-4000-8000-00000000f001',
  LEADER_ID: '5c000000-0000-4000-8000-00000000f002',
  ORG_ID: '5c000000-0000-4000-8000-0000000e0001',
  /** 이 실사원이 초대된 설문. */
  INVITED_SURVEY_ID: '5c000000-0000-4000-8000-0000000f0001',
  OWNER_TEAM_ID: '5c000000-0000-4000-8000-0000000a1111',
  OWNER_ID: '5c000000-0000-4000-8000-0000000a0001',
  SERVICE_REACHED: 'FIELDWORK DENIAL: 관문을 지나 서비스가 DB 에 닿았다',
}));

const { WORKER_ID, LEADER_ID, ORG_ID, INVITED_SURVEY_ID } = IDS;

// ─────────────────────────────────────────────────────────────────────────────
// 모킹 — 초대 행이 살아 있는 설문 하나, 그 밖은 전부 사고
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/db', async (importOriginal) => {
  // importOriginal 스프레드가 필수다 — `@/db` 는 스키마를 통째로 되내보낸다(db-stub 주석).
  const actual = await importOriginal<typeof import('@/db')>();
  const { createDbStub } = await import('@tests/helpers/db-stub');
  const { fieldworkOrgs, surveys, users } = await import('@/db/schema');

  const invitedRow = {
    id: IDS.INVITED_SURVEY_ID,
    teamId: IDS.OWNER_TEAM_ID,
    visibility: 'team',
    ownerUserId: IDS.OWNER_ID,
    assignmentStatus: 'assigned',
    deletedAt: null,
    participantKind: 'fieldwork',
    guestTabs: null,
    // 팀장의 파생 시야 — 로더가 EXISTS 로 채우는 칸이다. 목에서는 상수로 준다.
    fieldworkOrgInvited: true,
  };

  return {
    ...actual,
    db: createDbStub({
      reachedMessage: IDS.SERVICE_REACHED,
      /**
       * 조회는 셋만 살린다.
       *  - `surveys` : 관문이 판정에 쓰는 행(초대 컬럼이 조인으로 함께 실린다).
       *  - `users` + `fieldwork_orgs` : 주체 로더가 소속 업체·역할을 읽는 자리.
       *    없으면 소속이 null 이 되어 「실사라서 막혔다」와 「소속이 없어서 막혔다」가
       *    구별되지 않는다 — 검사하려는 것은 앞쪽이다.
       */
      rowsFor: (table) => {
        if (table === surveys) return [invitedRow];
        if (table === users || table === fieldworkOrgs) return [subjectRow];
        return [];
      },
      relationalRowFor: (table) => (table === 'surveys' ? invitedRow : undefined),
    }),
  };
});

// 주체 로더가 읽는 소속 — 팀장/실사원은 아래에서 role 만 갈아끼운다.
const subjectRow = vi.hoisted(() => ({ orgId: '', role: 'worker' as 'leader' | 'worker' }));
subjectRow.orgId = ORG_ID;

// 실사는 팀 멤버십 자체가 금지다(스펙 §1) — 로더도 조회하지 않지만, 목이 없으면 실 DB 를
// 두드리므로 함께 심는다.
vi.mock('@/server/read-models/team-memberships', () => ({
  getActiveTeamMemberships: vi.fn(async () => []),
  getTeamRole: vi.fn(async () => null),
}));

const workerUser = { id: WORKER_ID, isSuperadmin: true, userType: 'fieldwork' as const };
const leaderUser = { id: LEADER_ID, isSuperadmin: true, userType: 'fieldwork' as const };

/** 초대된 실사원 열 — 스펙 §8. 여기 없는 것이 「항상 차단」 목록이다. */
const INVITED_COLUMN: SurveyCapability[] = [
  'survey.view',
  'operations.view',
  'contacts.view',
  'contacts.writeAttempts',
];

const client = createRouterClient(router, {
  context: guestActorContext({ id: WORKER_ID, userType: 'fieldwork' }),
});

function callerFor(path: string): (input: unknown) => Promise<unknown> {
  const fn = path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], client as unknown);
  if (typeof fn !== 'function') throw new Error(`호출할 수 없는 경로: ${path}`);
  return fn as (input: unknown) => Promise<unknown>;
}

const procedures = enumerateProcedures();

/**
 * 내부 전용 베이스 — 실사가 통과하면 안 되는 표면 전수.
 *
 * 베이스 미들웨어가 입력 검증보다 **먼저** 돌기 때문에 입력을 채울 필요가 없다. 거부가
 * BAD_REQUEST 로 나온다면 그것 자체가 회귀 신호다(유형 게이트가 뒤로 밀렸다는 뜻).
 */
const internalOnlySurfaces = procedures
  .filter((p) => p.base === 'authed' || p.base === 'superadmin')
  .map((p) => p.path)
  .sort();

describe('내부 표면은 실사에게 전부 닫혀 있다', () => {
  it('열거기가 실제로 라우터를 훑는다', () => {
    // 0건이 되면 아래 검사가 통째로 무의미해진다.
    expect(internalOnlySurfaces.length).toBeGreaterThan(80);
  });

  it.each(internalOnlySurfaces)('%s 는 FORBIDDEN 이다', async (path) => {
    await expect(callerFor(path)({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('실사 초대 표면도 내부 전용이다 — 초대받은 사람이 남을 초대하지 못한다', () => {
    // 티켓 25 가 새로 만든 넷이 전부 authed 인지 확인한다. scoped 로 새면 실사원이
    // 자기 설문에 남을 붙일 수 있고, 그것은 「초대 추가는 접근 **내부인** 누구나」와 어긋난다.
    const fieldworkSurfaces = procedures
      .filter((p) => p.path.startsWith('workspace.fieldwork'))
      .map((p) => `${p.path}:${p.base}`)
      .sort();
    expect(fieldworkSurfaces).toEqual([
      'workspace.fieldwork.add:authed',
      'workspace.fieldwork.list:authed',
      'workspace.fieldwork.remove:authed',
      'workspace.fieldwork.searchCandidates:authed',
      'workspace.fieldworkOrgs.archive:superadmin',
      'workspace.fieldworkOrgs.create:superadmin',
      'workspace.fieldworkOrgs.list:superadmin',
      'workspace.fieldworkOrgs.options:superadmin',
      'workspace.fieldworkOrgs.update:superadmin',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 초대된 설문에서 열리는 것 — 정확히 넷
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKED_CAPABILITIES = surveyCapabilityValues.filter(
  (capability) => !INVITED_COLUMN.includes(capability),
);

describe('초대된 설문에서도 열리는 것은 조사 대상과 결과코드뿐이다', () => {
  it('capability 집합이 실사원 열과 정확히 같다', async () => {
    subjectRow.role = 'worker';
    const { capabilities } = await loadSurveyAccess(workerUser, INVITED_SURVEY_ID);
    expect([...capabilities].sort()).toEqual([...INVITED_COLUMN].sort());
  });

  it.each(BLOCKED_CAPABILITIES)('%s 는 관문이 거부한다', async (capability) => {
    subjectRow.role = 'worker';
    // 보이는 설문의 권한 부족이므로 forbidden — 존재는 이미 알고 있다(초대받았으니까).
    await expect(
      assertSurveyCapability(workerUser, INVITED_SURVEY_ID, capability),
    ).rejects.toThrow(SurveyAccessError);
    await expect(
      assertSurveyCapability(workerUser, INVITED_SURVEY_ID, capability),
    ).rejects.toMatchObject({ reason: 'forbidden' });
  });

  it('편집·응답 상세·메일·export·분석은 하나도 서지 않는다', async () => {
    subjectRow.role = 'worker';
    const { capabilities } = await loadSurveyAccess(workerUser, INVITED_SURVEY_ID);
    for (const capability of [
      'survey.edit',
      'survey.publish',
      'survey.delete',
      'survey.invite',
      'survey.manageAccess',
      'survey.transferOwnership',
      'responses.view',
      'contacts.manage',
      'mail.view',
      'mail.send',
      'analytics.view',
      'export.download',
      'surveyGroup.manage',
    ] as const) {
      expect(capabilities.has(capability), `${capability} 가 실사에게 서면 안 된다`).toBe(false);
    }
  });

  it('실사에게는 탭 축이 없다 — guestTabs 는 null 이다', async () => {
    subjectRow.role = 'worker';
    const { guestTabs } = await loadSurveyAccess(workerUser, INVITED_SURVEY_ID);
    expect(guestTabs).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 팀장의 파생 시야 — 초대 열보다 정확히 한 칸 좁다
// ─────────────────────────────────────────────────────────────────────────────

describe('팀장의 업체 시야는 열람 한정이다', () => {
  it('초대 없이 열리되 결과코드 쓰기 한 칸이 빠진다', async () => {
    subjectRow.role = 'leader';
    // 목의 설문 행에는 참여 행이 함께 실려 있으므로, 파생 시야만 재려면 kind 를 지운
    // 행이 필요하다 — 그 조합은 realdb 스위트가 잰다. 여기서는 「본인도 초대된 팀장」이
    // 실사원 열을 그대로 갖는다는 것을 본다(파생 시야가 권한을 깎지 않는다).
    const { capabilities } = await loadSurveyAccess(leaderUser, INVITED_SURVEY_ID);
    expect([...capabilities].sort()).toEqual([...INVITED_COLUMN].sort());
  });
});
