/**
 * 게스트 콘솔 — 무엇이 열리고 무엇이 오지 않는가 (역할 모델 v2 티켓 22) — 실 로컬 DB.
 *
 * 티켓 21 이 「부여됐는가」를 세웠고 22 가 그 위에 **탭 축**을 얹었다. 그래서 이 스위트가
 * 묻는 것은 셋이다.
 *  ① **홈 목록이 부여된 설문만, 설문마다 다른 탭 구성으로 나오는가** — 1계정 N설문이
 *     이 콘솔의 전제라, 두 설문의 탭이 섞이면 화면이 통째로 거짓말을 한다.
 *  ② **탭 관문이 주소 축에서도 서는가** — 화면이 탭을 안 그리는 것과 주소를 직접 쳤을 때
 *     막히는 것은 다른 문제다. 「존재 자체가 보이지 않는다」(.pen 5-3 노트)가 화면만의
 *     약속이면 그것은 약속이 아니다.
 *  ③ **마스킹본에 원문·초대 토큰이 실려 오지 않는가** — 게스트 컨택 표의 계약은 화면이
 *     무엇을 안 그리는가가 아니라 **무엇이 도착하지 않는가**다. 초대 토큰이 가면 열람이
 *     대리 응답이 된다.
 *
 * 실 DB 인 이유: ①③ 이 전부 조인·서브쿼리·WHERE 이고 ②의 입력도 그 조인 결과다. 목이
 * 돌려주는 행은 언제나 테스트가 정한 행이라 조건이 무엇이든 통과한다.
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactPii as contactPiiTable,
  contactTargets as contactTargetsTable,
  surveyParticipants as participantsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { AuthUser } from '@/shared/contracts/auth';
import type { SurveyGuestTabs } from '@/shared/contracts/workspace';

const authState = vi.hoisted(() => ({ user: null as AuthUser | null }));

// 세션 계층은 이 스위트의 대상이 아니다 — 판정과 투영이 대상이다.
vi.mock('@/lib/auth', () => ({
  requireActiveAccount: vi.fn(async () => {
    if (!authState.user) throw new Error('인증이 필요합니다.');
    return authState.user;
  }),
}));

// notFound·redirect 는 던지는 신호다. 실제 Next 런타임과 같은 방향이라 단언이 성립한다.
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const { assertGuestSurveyPageAccess } = await import('@/server/page-guest-access');
const { listGuestSurveys } = await import('@/server/read-models/guest-surveys');
const { listGuestContacts } = await import('@/server/read-models/guest-contacts');

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const OWNER_ID = crypto.randomUUID();
const GUEST_ID = crypto.randomUUID();
const OTHER_GUEST_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();

const ALL_USER_IDS = [OWNER_ID, GUEST_ID, OTHER_GUEST_ID];

/** 응답 현황만 열린 설문. */
let overviewOnlyId = '';
/** 진척 보고 + 조사 대상이 열린 설문 — 같은 계정, 다른 탭 구성. */
let contactsSurveyId = '';
/** 부여되지 않은 설문 — 같은 팀이지만 이 게스트의 것이 아니다. */
let foreignSurveyId = '';
/** 배치 대기 설문 — 부여돼 있어도 아무도 못 연다(ADR-0006). */
let pendingSurveyId = '';

const OVERVIEW_ONLY: SurveyGuestTabs = {
  overview: true,
  progressReport: false,
  contactsMasked: false,
  quota: false,
};
const REPORT_AND_CONTACTS: SurveyGuestTabs = {
  overview: false,
  progressReport: true,
  contactsMasked: true,
  quota: false,
};

function guestUser(id = GUEST_ID): AuthUser {
  return {
    id,
    email: `guest-console-${id}@example.com`,
    name: '김담당',
    status: 'active',
    isSuperadmin: false,
    userType: 'guest',
  };
}

async function seedUser(id: string, userType: 'internal' | 'guest'): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `guest-console-${id}@example.com`,
    emailVerified: true,
    status: 'active',
    isSuperadmin: false,
    userType,
  });
}

async function seedSurvey(
  title: string,
  over: { assignmentPending?: boolean } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id,
    title,
    ...(over.assignmentPending
      ? { teamId: null, assignmentStatus: 'assignment_pending' as const }
      : { teamId: TEAM_ID, assignmentStatus: 'assigned' as const }),
    visibility: 'team',
    ownerUserId: OWNER_ID,
    createdBy: OWNER_ID,
  });
  return id;
}

async function grant(surveyId: string, tabs: SurveyGuestTabs, userId = GUEST_ID): Promise<void> {
  await db.insert(participantsTable).values({
    surveyId,
    userId,
    kind: 'guest',
    guestTabs: tabs,
    addedBy: OWNER_ID,
  });
}

describe.skipIf(!isLocalDb)('게스트 콘솔 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(OWNER_ID, 'internal');
    await seedUser(GUEST_ID, 'guest');
    await seedUser(OTHER_GUEST_ID, 'guest');
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `게스트콘솔팀-${TEAM_ID.slice(0, 8)}` });
    await db.insert(teamMembersTable).values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'member' });
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    authState.user = guestUser();
    const previous = [overviewOnlyId, contactsSurveyId, foreignSurveyId, pendingSurveyId].filter(
      Boolean,
    );
    if (previous.length > 0) {
      await db.delete(surveysTable).where(inArray(surveysTable.id, previous));
    }

    overviewOnlyId = await seedSurvey('응답 현황만 조사');
    contactsSurveyId = await seedSurvey('진척·조사 대상 조사');
    foreignSurveyId = await seedSurvey('부여되지 않은 조사');
    pendingSurveyId = await seedSurvey('배치 대기 조사', { assignmentPending: true });

    await grant(overviewOnlyId, OVERVIEW_ONLY);
    await grant(contactsSurveyId, REPORT_AND_CONTACTS);
    await grant(pendingSurveyId, OVERVIEW_ONLY);
    // 대조군 — 다른 게스트의 부여는 이 사람 목록에 새면 안 된다.
    await grant(foreignSurveyId, OVERVIEW_ONLY, OTHER_GUEST_ID);
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    const all = [overviewOnlyId, contactsSurveyId, foreignSurveyId, pendingSurveyId].filter(Boolean);
    if (all.length > 0) await db.delete(surveysTable).where(inArray(surveysTable.id, all));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, ALL_USER_IDS));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(inArray(usersTable.id, ALL_USER_IDS));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 홈 목록
  // ───────────────────────────────────────────────────────────────────────────

  describe('홈은 부여된 설문만, 설문마다 자기 탭으로 그린다', () => {
    it('두 설문이 각자의 탭 구성으로 나온다 — 1계정 N설문', async () => {
      const rows = await listGuestSurveys(GUEST_ID);
      const byId = new Map(rows.map((row) => [row.surveyId, row]));

      expect(byId.get(overviewOnlyId)?.tabs).toEqual(OVERVIEW_ONLY);
      expect(byId.get(contactsSurveyId)?.tabs).toEqual(REPORT_AND_CONTACTS);
    });

    it('남의 부여는 새지 않는다', async () => {
      const ids = (await listGuestSurveys(GUEST_ID)).map((row) => row.surveyId);
      expect(ids).not.toContain(foreignSurveyId);
    });

    it('배치 대기 설문은 부여돼 있어도 목록에 없다 — 눌러도 안 열리는 카드를 만들지 않는다', async () => {
      const ids = (await listGuestSurveys(GUEST_ID)).map((row) => row.surveyId);
      expect(ids).not.toContain(pendingSurveyId);
    });

    it('삭제된 설문도 목록에서 사라진다', async () => {
      await db
        .update(surveysTable)
        .set({ deletedAt: new Date() })
        .where(eq(surveysTable.id, overviewOnlyId));

      const ids = (await listGuestSurveys(GUEST_ID)).map((row) => row.surveyId);
      expect(ids).not.toContain(overviewOnlyId);
    });

    it('미발행 설문은 draft 로 표기된다 — 기간의 시작이 없다', async () => {
      const row = (await listGuestSurveys(GUEST_ID)).find((r) => r.surveyId === overviewOnlyId);
      expect(row?.lifecycle).toBe('draft');
      expect(row?.publishedAt).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 탭 관문 — 주소 축에서도 선다
  // ───────────────────────────────────────────────────────────────────────────

  describe('탭 관문', () => {
    it('허용된 탭은 통과하고 탭 구성을 함께 돌려준다', async () => {
      const viewer = await assertGuestSurveyPageAccess(overviewOnlyId, 'overview');
      expect(viewer.tabs).toEqual(OVERVIEW_ONLY);
    });

    it.each(['progressReport', 'contactsMasked', 'quota'] as const)(
      '허용 안 된 탭(%s)은 주소를 직접 쳐도 notFound 다',
      async (tab) => {
        await expect(assertGuestSurveyPageAccess(overviewOnlyId, tab)).rejects.toThrow(
          'NEXT_NOT_FOUND',
        );
      },
    );

    it('설문지 미리보기는 화이트리스트 밖이라 언제나 열린다', async () => {
      // 탭을 하나도 안 켠 부여에서도 미리보기는 열린다(스펙 §5 「보는 것 ①」).
      await db
        .update(participantsTable)
        .set({
          guestTabs: {
            overview: false,
            progressReport: false,
            contactsMasked: false,
            quota: false,
          },
        })
        .where(eq(participantsTable.surveyId, overviewOnlyId));

      await expect(assertGuestSurveyPageAccess(overviewOnlyId)).resolves.toMatchObject({
        tabs: { overview: false },
      });
      await expect(assertGuestSurveyPageAccess(overviewOnlyId, 'overview')).rejects.toThrow(
        'NEXT_NOT_FOUND',
      );
    });

    it('부여되지 않은 설문은 탭과 무관하게 notFound — 존재를 알리지 않는다', async () => {
      await expect(assertGuestSurveyPageAccess(foreignSurveyId)).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(assertGuestSurveyPageAccess(foreignSurveyId, 'overview')).rejects.toThrow(
        'NEXT_NOT_FOUND',
      );
    });

    it('배치 대기 설문은 부여돼 있어도 열리지 않는다', async () => {
      await expect(assertGuestSurveyPageAccess(pendingSurveyId, 'overview')).rejects.toThrow(
        'NEXT_NOT_FOUND',
      );
    });

    it('내부 계정은 이 문을 지나지 못한다 — 게스트 구역이다', async () => {
      authState.user = { ...guestUser(OWNER_ID), userType: 'internal' };
      await expect(assertGuestSurveyPageAccess(overviewOnlyId)).rejects.toThrow(
        'REDIRECT:/admin/surveys',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 마스킹 투영 — 무엇이 도착하지 않는가
  // ───────────────────────────────────────────────────────────────────────────

  describe('조사 대상 마스킹본', () => {
    beforeEach(async () => {
      if (!isLocalDb) return;
      // 컬럼 스킴: 시스템ID + 일반 attrs + PII(전화) + 메일 상태.
      await db
        .update(surveysTable)
        .set({
          contactColumns: {
            version: 1,
            headerRow: 1,
            columns: [
              { key: 'resid', label: '시스템ID', source: 'system.resid', order: 0 },
              { key: '기관명', label: '기관명', source: 'attrs.기관명', order: 1 },
              {
                key: '연락처',
                label: '연락처',
                source: 'pii.연락처',
                order: 2,
                piiType: 'phone',
              },
              { key: 'mail', label: '메일', source: 'system.email_count', order: 3 },
            ],
          },
        })
        .where(eq(surveysTable.id, contactsSurveyId));

      const targetId = crypto.randomUUID();
      await db.insert(contactTargetsTable).values({
        id: targetId,
        surveyId: contactsSurveyId,
        resid: 1,
        isTest: false,
        // inviteCode 는 앱이 발번하는 NOT NULL 컬럼이다 — 직접 INSERT 라 손으로 채운다.
        inviteCode: targetId.slice(0, 8),
        attrs: { 기관명: '한국물류협회' },
      });
      await db.insert(contactPiiTable).values({
        contactTargetId: targetId,
        fieldType: 'phone',
        columnKey: '연락처',
        cipher: 'ciphertext-not-read-by-list',
        blindIndex: 'blind-index',
        maskHint: '010-****-5678',
      });
    });

    it('PII 컬럼은 마스킹 힌트로만 온다 — 원문도 cipher 도 없다', async () => {
      const page = await listGuestContacts(contactsSurveyId, 1);
      const row = page.rows[0];

      expect(row?.cells).toContain('010-****-5678');
      expect(JSON.stringify(page)).not.toContain('ciphertext-not-read-by-list');
    });

    it('초대 토큰과 컨택 id 가 행에 실려 오지 않는다 — 열람이 대리 응답이 되지 않는다', async () => {
      const [stored] = await db
        .select({ id: contactTargetsTable.id, inviteToken: contactTargetsTable.inviteToken })
        .from(contactTargetsTable)
        .where(eq(contactTargetsTable.surveyId, contactsSurveyId));

      const serialized = JSON.stringify(await listGuestContacts(contactsSurveyId, 1));
      expect(serialized).not.toContain(stored?.inviteToken ?? 'no-token');
      expect(serialized).not.toContain(stored?.id ?? 'no-id');
    });

    it('메일 컬럼은 아예 빠진다 — 메일 축은 게스트에게 항상 차단이다', async () => {
      const page = await listGuestContacts(contactsSurveyId, 1);
      expect(page.columns.map((c) => c.label)).toEqual(['시스템ID', '기관명', '연락처']);
    });

    it('일반 attrs 컬럼은 그대로 보인다 — 마스킹의 단위는 스킴의 piiType 이다', async () => {
      const page = await listGuestContacts(contactsSurveyId, 1);
      expect(page.rows[0]?.cells).toContain('한국물류협회');
    });
  });
});
