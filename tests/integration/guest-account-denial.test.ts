/**
 * 게스트 계정 음성 스위트 — 부여된 설문에서도 무엇이 닫혀 있는가 (역할 모델 v2 티켓 21).
 *
 * 묻는 것은 둘이다.
 *  ① **내부 표면은 부여와 무관하게 전부 닫혀 있는가.** 라우터를 런타임에 열거해
 *     authed·superadmin 표면 전수를 게스트 컨텍스트로 두드린다 — 손으로 적은 목록이 아니라
 *     라우터가 목록의 출처라 새 procedure 가 붙으면 저절로 검사 대상이 된다.
 *  ② **부여된 설문에서 열리는 capability 가 정확히 둘인가.** 게스트 열은 survey.view +
 *     operations.view 이고, 나머지 어휘 전부에 대해 관문이 거부해야 한다. 이 검사가
 *     scoped 표면(메일·컨택·응답 상세·export)까지 덮는다: 그 표면들이 무엇을 요구하는지는
 *     `cross-team-idor-rpc.test.ts` 의 인벤토리가 표면별로 못 박고 있고, 여기서는 그
 *     capability 들이 게스트에게 **하나도 서지 않는다**를 어휘 전수로 확인한다.
 *
 * ①이 중간에 서비스로 새는 것은 db 목이 잡는다 — 관문이 없으면 「관문을 지나 DB 에 닿았다」
 * 가 그대로 실패 메시지로 나온다.
 *
 * REST 표면(export 3종)은 라우터에 없어 여기서 열거되지 않는다 —
 * `tests/unit/api/export-route-auth.test.ts` 가 같은 축을 진다.
 */
import { createRouterClient } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';

import { router } from '@/server/router';
import {
  assertSurveyCapability,
  loadSurveyAccess,
  SurveyAccessError,
} from '@/server/survey-access';
import {
  DEFAULT_SURVEY_GUEST_TABS,
  surveyCapabilityValues,
  type SurveyCapability,
} from '@/shared/contracts/workspace';
import { guestActorContext } from '@tests/helpers/rpc-context';
import { enumerateProcedures } from '@tests/helpers/rpc-surface';

const IDS = vi.hoisted(() => ({
  GUEST_ID: '4b000000-0000-4000-8000-00000000c001',
  /** 이 게스트에게 부여된 설문. */
  GRANTED_SURVEY_ID: '4b000000-0000-4000-8000-0000000f0001',
  OWNER_TEAM_ID: '4b000000-0000-4000-8000-0000000a1111',
  OWNER_ID: '4b000000-0000-4000-8000-0000000a0001',
  SERVICE_REACHED: 'GUEST DENIAL: 관문을 지나 서비스가 DB 에 닿았다',
}));

const { GUEST_ID, GRANTED_SURVEY_ID } = IDS;

// ─────────────────────────────────────────────────────────────────────────────
// 모킹 — 부여 행이 살아 있는 설문 하나, 그 밖은 전부 사고
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/db', async (importOriginal) => {
  // importOriginal 스프레드가 필수다 — `@/db` 는 스키마를 통째로 되내보낸다(db-stub 주석).
  const actual = await importOriginal<typeof import('@/db')>();
  const { createDbStub } = await import('@tests/helpers/db-stub');
  const { surveys } = await import('@/db/schema');

  /**
   * 판정 로더는 `surveys` 에서 시작해 `survey_participants` 를 LEFT JOIN 하므로 행이 하나다.
   * 부여 컬럼(participantKind·guestTabs)이 그 행에 함께 실린다.
   */
  const grantedRow = {
    id: IDS.GRANTED_SURVEY_ID,
    teamId: IDS.OWNER_TEAM_ID,
    visibility: 'team',
    ownerUserId: IDS.OWNER_ID,
    assignmentStatus: 'assigned',
    deletedAt: null,
    participantKind: 'guest',
    guestTabs: null,
  };

  return {
    ...actual,
    db: createDbStub({
      reachedMessage: IDS.SERVICE_REACHED,
      rowsFor: (table) => (table === surveys ? [grantedRow] : []),
      relationalRowFor: (table) => (table === 'surveys' ? grantedRow : undefined),
    }),
  };
});

// 게스트는 팀 멤버십 자체가 금지다(스펙 §1) — 로더도 조회하지 않지만, 목이 없으면 실 DB 를
// 두드리므로 함께 심는다.
vi.mock('@/server/read-models/team-memberships', () => ({
  getActiveTeamMemberships: vi.fn(async () => []),
  getTeamRole: vi.fn(async () => null),
}));

const guest = { id: GUEST_ID, isSuperadmin: true, userType: 'guest' as const };

/** 게스트 열 — 스펙 §8. 여기 없는 것이 「항상 차단」 목록이다. */
const GUEST_COLUMN: SurveyCapability[] = ['survey.view', 'operations.view'];

const client = createRouterClient(router, { context: guestActorContext({ id: GUEST_ID }) });

function callerFor(path: string): (input: unknown) => Promise<unknown> {
  const fn = path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], client as unknown);
  if (typeof fn !== 'function') throw new Error(`호출할 수 없는 경로: ${path}`);
  return fn as (input: unknown) => Promise<unknown>;
}

const procedures = enumerateProcedures();

/**
 * 내부 전용 베이스 — 게스트가 통과하면 안 되는 표면 전수.
 *
 * 베이스 미들웨어가 입력 검증보다 **먼저** 돌기 때문에 입력을 채울 필요가 없다. 거부가
 * BAD_REQUEST 로 나온다면 그것 자체가 회귀 신호다(유형 게이트가 뒤로 밀렸다는 뜻).
 */
const internalOnlySurfaces = procedures
  .filter((p) => p.base === 'authed' || p.base === 'superadmin')
  .map((p) => p.path)
  .sort();

describe('내부 표면은 게스트에게 전부 닫혀 있다', () => {
  it('열거기가 실제로 라우터를 훑는다', () => {
    // 0건이 되면 아래 검사가 통째로 무의미해진다.
    expect(internalOnlySurfaces.length).toBeGreaterThan(80);
  });

  it.each(internalOnlySurfaces)('%s 는 FORBIDDEN 이다', async (path) => {
    await expect(callerFor(path)({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('게스트가 지날 수 있는 베이스는 pub·account·scoped 뿐이다 — 분류 고정', () => {
    const reachable = new Set(
      procedures.filter((p) => !internalOnlySurfaces.includes(p.path)).map((p) => p.base),
    );
    expect([...reachable].sort()).toEqual(['account', 'pub', 'scoped']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 부여된 설문에서 열리는 것 — 정확히 둘
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKED_CAPABILITIES = surveyCapabilityValues.filter(
  (capability) => !GUEST_COLUMN.includes(capability),
);

describe('부여된 설문에서도 열리는 것은 프리뷰와 현황뿐이다', () => {
  it('capability 집합이 게스트 열과 정확히 같다', async () => {
    const { capabilities } = await loadSurveyAccess(guest, GRANTED_SURVEY_ID);
    expect([...capabilities].sort()).toEqual([...GUEST_COLUMN].sort());
  });

  it.each(BLOCKED_CAPABILITIES)('%s 는 관문이 거부한다', async (capability) => {
    // 보이는 설문의 권한 부족이므로 forbidden — 존재는 이미 알고 있다(부여받았으니까).
    await expect(assertSurveyCapability(guest, GRANTED_SURVEY_ID, capability)).rejects.toThrow(
      SurveyAccessError,
    );
    await expect(
      assertSurveyCapability(guest, GRANTED_SURVEY_ID, capability),
    ).rejects.toMatchObject({ reason: 'forbidden' });
  });

  it('scoped 표면이 요구하는 것들이 한 개도 서지 않는다 — 메일·컨택·응답 상세·export', async () => {
    // cross-team-idor-rpc 의 인벤토리가 표면별 요구를 못 박고, 여기서는 그 요구들이
    // 게스트에게 서지 않는 것을 본다. 둘이 합쳐져야 「전 표면 차단」이 증명된다.
    const { capabilities } = await loadSurveyAccess(guest, GRANTED_SURVEY_ID);
    for (const capability of [
      'mail.view',
      'mail.send',
      'contacts.view',
      'contacts.manage',
      'contacts.writeAttempts',
      'responses.view',
      'export.download',
      'analytics.view',
      'survey.edit',
      'survey.invite',
      'survey.manageAccess',
    ] as const) {
      expect(capabilities.has(capability), `${capability} 가 게스트에게 서면 안 된다`).toBe(false);
    }
  });

  it('탭이 비어 있는 부여는 기본값(응답 현황만)으로 읽힌다', async () => {
    const { guestTabs } = await loadSurveyAccess(guest, GRANTED_SURVEY_ID);
    expect(guestTabs).toEqual(DEFAULT_SURVEY_GUEST_TABS);
  });
});

// 「부여되지 않은 설문은 존재조차 알리지 않는다」는 여기서 묻지 않는다 — 목의 rowsFor 는
// WHERE 를 모르고 어떤 id 에도 같은 행을 돌려주므로, 조인 결과가 정말 null 이 되는지는
// 목으로 증명할 수 없다. 그 축은 `survey-guest-grants.realdb.test.ts` 가 진다.
