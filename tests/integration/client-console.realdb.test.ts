/**
 * 클라이언트 링크 콘솔 — 무엇이 열리고 무엇이 오지 않는가 (ADR-0029) — 실 로컬 DB.
 *
 * 본보기는 `guest-console.realdb.test.ts` 다. 화면은 한 벌이고(`app/_client-console`) 입구만
 * 둘이라, 이 스위트가 묻는 것은 **링크 입구의 관문**이다.
 *  ① **탭 관문** — 연구원이 켠 탭만 열리고, 끄면 같은 세션의 다음 요청부터 닫힌다.
 *     미리보기는 탭을 묻지 않는다.
 *  ② **거부의 두 갈래** — 접속 전·세션 끊김·닫힘은 **입구로 보내고**(거기서 비밀번호를 다시
 *     받거나 닫힘을 안내한다), 탭 밖은 **notFound** 다. 갈라 말하지 않는 것은 뒤쪽이다:
 *     주소 조작으로 탭 구성이 확인되면 안 된다.
 *  ③ **중단과 종료** — 중단 중에도 콘솔이 열리고 화면 머리가 「일시중지」를 말한다. 종료하면
 *     다음 요청에서 입구로 간다.
 *  ④ **칸막이** — 다른 링크의 쿠키, 외주 실사 링크의 토큰으로는 아무것도 열리지 않는다.
 *  ⑤ **마스킹 투영** — 조사 대상 표에 원문·암호문·초대 토큰·컨택 id·메일 열이 오지 않는다.
 *
 * 실 DB 인 이유: 관문의 입력이 전부 조인 결과다(링크 행 × 설문 상태 × 탭 컬럼). 목이
 * 돌려주는 행은 테스트가 정한 행이라 조건이 무엇이든 통과한다.
 */
import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import {
  contactPii as contactPiiTable,
  contactTargets as contactTargetsTable,
  surveys as surveysTable,
  surveyVersions as versionsTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import {
  type ClientLinkTabs,
  clientLinkTabValues,
  DEFAULT_CLIENT_LINK_TABS,
  NO_CLIENT_LINK_TABS,
} from '@/shared/contracts/workspace';

const requestState = vi.hoisted(() => ({ headers: new Headers() }));

// 관문은 요청 헤더에서 쿠키를 읽는다 — vitest 에는 요청 컨텍스트가 없어 그 자리만 세운다.
vi.mock('next/headers', () => ({ headers: async () => requestState.headers }));

// notFound·redirect 는 던지는 신호다. 실제 Next 런타임과 같은 방향이라 단언이 성립한다.
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const { assertClientLinkPageAccess } = await import('@/server/page-client-link-access');
const { authenticateAccessLink, authenticateClientLink } = await import('@/server/access-link');
const { setClosed } = await import('@/server/operations/services/control');
const { listGuestContacts } = await import('@/server/read-models/guest-contacts');
const { getClientSurveyHeader } = await import('@/server/read-models/guest-surveys');
const { accessLinks } = await import('@/server/workspace/procedures/access-links');

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const OWNER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();
const PASSWORD = 'ClientPw2026';

/** 새 링크의 칩 — 응답 현황 · 상세 통계 · 설문 보기. */
const NEW_LINK_TABS: ClientLinkTabs = DEFAULT_CLIENT_LINK_TABS;

let surveyId = '';

const admin = createRouterClient(
  { accessLinks },
  {
    context: {
      db,
      user: {
        id: OWNER_ID,
        email: `client-console-${OWNER_ID}@example.com`,
        name: '링크발급자',
        status: 'active',
        isSuperadmin: false,
        userType: 'internal',
      },
    } satisfies ORPCContext,
  },
);

function signInAs(...cookies: Array<{ name: string; value: string }>): void {
  requestState.headers = new Headers({
    cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
  });
}

async function seedSurvey(title: string): Promise<string> {
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id,
    title,
    status: 'published',
    teamId: TEAM_ID,
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: OWNER_ID,
    createdBy: OWNER_ID,
  });
  // 발행된 설문이어야 진행 상태가 「미발행」으로 접히지 않는다 — 판정이 배포 버전을 본다.
  await db.insert(versionsTable).values({
    id: versionId,
    surveyId: id,
    versionNumber: 1,
    status: 'published',
    snapshot: {} as never,
  });
  await db.update(surveysTable).set({ currentVersionId: versionId }).where(eq(surveysTable.id, id));
  return id;
}

/**
 * 탭 구성을 통째로 맞춘다 — 테스트 편의다.
 *
 * 저장 표면은 칩 하나씩만 받는다(낡은 화면의 저장이 남의 변경을 되돌리지 않게). 여기서는
 * 「이 구성일 때 무엇이 열리는가」를 묻는 것이 목적이라 네 칩을 차례로 맞춘다.
 */
async function setTabs(target: ClientLinkTabs): Promise<void> {
  for (const tab of clientLinkTabValues) {
    await admin.accessLinks.setClientTab({ surveyId, tab, enabled: target[tab] });
  }
}

/** 클라이언트 링크를 발급하고, 그 세션의 쿠키를 요청에 실은 상태로 만든다. */
async function issueAndEnter(target = surveyId) {
  const { link } = await admin.accessLinks.issue({
    surveyId: target,
    kind: 'client',
    password: PASSWORD,
  });
  const auth = await authenticateClientLink(link.token, PASSWORD);
  if (!auth.ok) throw new Error(`접속 실패: ${auth.reason}`);
  signInAs(auth.cookie);
  return { token: link.token, cookie: auth.cookie };
}

describe.skipIf(!isLocalDb)('클라이언트 링크 콘솔 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values({
      id: OWNER_ID,
      name: '링크발급자',
      email: `client-console-${OWNER_ID}@example.com`,
      emailVerified: true,
      status: 'active',
      userType: 'internal',
    });
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `클라콘솔팀-${TEAM_ID.slice(0, 8)}` });
    await db
      .insert(teamMembersTable)
      .values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'leader' });
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    surveyId = await seedSurvey('고객사 열람 조사');
    requestState.headers = new Headers();
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    await db.delete(teamMembersTable).where(eq(teamMembersTable.teamId, TEAM_ID));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(eq(usersTable.id, OWNER_ID));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 탭 관문
  // ───────────────────────────────────────────────────────────────────────────

  describe('탭 관문', () => {
    it('허용된 탭은 통과하고, 관문이 설문 id 와 탭 구성을 돌려준다', async () => {
      const { token } = await issueAndEnter();
      // 설문 id 는 주소가 아니라 링크 행에서 나온다 — 화면이 다른 설문을 지목할 길이 없다.
      await expect(assertClientLinkPageAccess(token, 'overview')).resolves.toEqual({
        surveyId,
        tabs: NEW_LINK_TABS,
      });
    });

    it.each(['progressReport', 'contactsMasked', 'quota'] as const)(
      '켜지 않은 탭 %s 는 notFound 다',
      async (tab) => {
        const { token } = await issueAndEnter();
        await expect(assertClientLinkPageAccess(token, tab)).rejects.toThrow('NEXT_NOT_FOUND');
      },
    );

    it('설문 보기는 새 링크에서 켜져 있다 — 현황 탭을 전부 꺼도', async () => {
      const { token } = await issueAndEnter();
      await setTabs({ ...NO_CLIENT_LINK_TABS, preview: true });
      await expect(assertClientLinkPageAccess(token, 'preview')).resolves.toMatchObject({
        surveyId,
      });
      await expect(assertClientLinkPageAccess(token, 'overview')).rejects.toThrow(
        'NEXT_NOT_FOUND',
      );
    });

    it('설문 보기 칩을 끄면 미리보기 주소가 notFound 다 — 버튼만 감추지 않는다', async () => {
      const { token } = await issueAndEnter();
      await admin.accessLinks.setClientTab({ surveyId, tab: 'preview', enabled: false });
      await expect(assertClientLinkPageAccess(token, 'preview')).rejects.toThrow(
        'NEXT_NOT_FOUND',
      );
      // 다른 칩은 그대로다 — 칩 하나만 바뀐다.
      await expect(assertClientLinkPageAccess(token, 'overview')).resolves.toMatchObject({
        tabs: { ...NEW_LINK_TABS, preview: false },
      });
    });

    it('칩이 전부 꺼져도 셸(탭 없는 관문)은 열린다 — 빈 안내를 그릴 자리다', async () => {
      const { token } = await issueAndEnter();
      await setTabs(NO_CLIENT_LINK_TABS);
      await expect(assertClientLinkPageAccess(token)).resolves.toEqual({
        surveyId,
        tabs: NO_CLIENT_LINK_TABS,
      });
    });

    /**
     * 「화면이 탭을 안 그린다」와 「주소를 직접 쳐도 막힌다」는 다른 문제다. 같은 쿠키로 다시
     * 물었는데 답이 바뀌어야 한다 — 탭이 쿠키에 실려 있었다면 여기서 빨개진다.
     */
    it('연구원이 탭을 켜고 끄면 같은 세션의 다음 요청부터 반영된다', async () => {
      const { token } = await issueAndEnter();
      await expect(assertClientLinkPageAccess(token, 'quota')).rejects.toThrow('NEXT_NOT_FOUND');

      await admin.accessLinks.setClientTab({ surveyId, tab: 'quota', enabled: true });
      await expect(assertClientLinkPageAccess(token, 'quota')).resolves.toMatchObject({
        tabs: { quota: true },
      });

      await admin.accessLinks.setClientTab({ surveyId, tab: 'quota', enabled: false });
      await expect(assertClientLinkPageAccess(token, 'quota')).rejects.toThrow('NEXT_NOT_FOUND');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 거부의 두 갈래 — 입구로 보내기
  // ───────────────────────────────────────────────────────────────────────────

  describe('접속 전·세션 끊김은 입구로 보낸다', () => {
    it('쿠키가 없으면 입구다 — notFound 로 접으면 「링크가 죽었다」로 읽힌다', async () => {
      const { token } = await issueAndEnter();
      requestState.headers = new Headers();
      await expect(assertClientLinkPageAccess(token, 'overview')).rejects.toThrow(
        `REDIRECT:/client/${token}`,
      );
    });

    it('없는 토큰도 입구다 — 존재를 갈라 말하지 않는다', async () => {
      await expect(
        assertClientLinkPageAccess('noSuchToken_0123456789', 'overview'),
      ).rejects.toThrow('REDIRECT:/client/noSuchToken_0123456789');
    });

    it('비밀번호가 바뀌면 선 세션이 입구로 돌아간다', async () => {
      const { token } = await issueAndEnter();
      await admin.accessLinks.resetPassword({ surveyId, kind: 'client', password: 'NextPw2026' });
      await expect(assertClientLinkPageAccess(token, 'overview')).rejects.toThrow(
        `REDIRECT:/client/${token}`,
      );
    });

    it('링크를 종료하면 입구로 돌아간다', async () => {
      const { token } = await issueAndEnter();
      await admin.accessLinks.close({ surveyId, kind: 'client' });
      await expect(assertClientLinkPageAccess(token)).rejects.toThrow(`REDIRECT:/client/${token}`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 중단과 종료
  // ───────────────────────────────────────────────────────────────────────────

  describe('중단에는 열려 있고 종료에 닫힌다', () => {
    it('중단 중에도 콘솔이 열리고 화면 머리가 일시중지를 말한다', async () => {
      const { token } = await issueAndEnter();
      await db.update(surveysTable).set({ isPaused: true }).where(eq(surveysTable.id, surveyId));

      await expect(assertClientLinkPageAccess(token, 'overview')).resolves.toMatchObject({
        surveyId,
      });
      expect(await getClientSurveyHeader(surveyId)).toMatchObject({
        title: '고객사 열람 조사',
        lifecycle: 'paused',
      });
    });

    it('종료하면 다음 요청에서 입구로 가고, 종료를 취소하면 같은 쿠키로 다시 열린다', async () => {
      const { token } = await issueAndEnter();
      await setClosed({ surveyId, isClosed: true });
      for (const tab of ['overview', undefined] as const) {
        await expect(assertClientLinkPageAccess(token, tab)).rejects.toThrow(
          `REDIRECT:/client/${token}`,
        );
      }

      await setClosed({ surveyId, isClosed: false });
      await expect(assertClientLinkPageAccess(token, 'overview')).resolves.toMatchObject({
        surveyId,
      });
    });

    it('삭제된 설문의 콘솔은 입구로 간다', async () => {
      const { token } = await issueAndEnter();
      await db
        .update(surveysTable)
        .set({ deletedAt: new Date() })
        .where(eq(surveysTable.id, surveyId));
      await expect(assertClientLinkPageAccess(token, 'overview')).rejects.toThrow(
        `REDIRECT:/client/${token}`,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 칸막이
  // ───────────────────────────────────────────────────────────────────────────

  describe('다른 링크로는 열리지 않는다', () => {
    it('이웃 설문 링크의 쿠키로 이 주소를 열면 입구다 — 이름을 바꿔 실어도 같다', async () => {
      const mine = await issueAndEnter();
      const neighbourId = await seedSurvey('이웃 조사');
      try {
        const neighbour = await issueAndEnter(neighbourId);

        // 이웃 쿠키만 든 브라우저.
        signInAs(neighbour.cookie);
        await expect(assertClientLinkPageAccess(mine.token, 'overview')).rejects.toThrow(
          `REDIRECT:/client/${mine.token}`,
        );
        // 이웃 쿠키의 값을 내 링크의 이름으로 옮겨 실은 요청.
        signInAs({ name: mine.cookie.name, value: neighbour.cookie.value });
        await expect(assertClientLinkPageAccess(mine.token, 'overview')).rejects.toThrow(
          `REDIRECT:/client/${mine.token}`,
        );
        // 대조군 — 각자의 주소에서는 각자의 설문이 열린다.
        signInAs(mine.cookie, neighbour.cookie);
        await expect(assertClientLinkPageAccess(mine.token, 'overview')).resolves.toMatchObject({
          surveyId,
        });
        await expect(
          assertClientLinkPageAccess(neighbour.token, 'overview'),
        ).resolves.toMatchObject({ surveyId: neighbourId });
      } finally {
        await db.delete(surveysTable).where(eq(surveysTable.id, neighbourId));
      }
    });

    it('외주 실사 링크의 토큰과 세션으로는 클라이언트 콘솔이 열리지 않는다', async () => {
      const fieldwork = await admin.accessLinks.issue({ surveyId, kind: 'fieldwork' });
      const auth = await authenticateAccessLink(fieldwork.link.token, fieldwork.password);
      if (!auth.ok) throw new Error('외주 링크 접속 실패');

      signInAs(auth.cookie, { name: `cl_${fieldwork.link.token}`, value: auth.cookie.value });
      await expect(
        assertClientLinkPageAccess(fieldwork.link.token, 'overview'),
      ).rejects.toThrow(`REDIRECT:/client/${fieldwork.link.token}`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑤ 마스킹 투영 — 무엇이 도착하지 않는가
  // ───────────────────────────────────────────────────────────────────────────

  describe('조사 대상 마스킹본', () => {
    let targetId = '';

    beforeEach(async () => {
      if (!isLocalDb) return;
      await db
        .update(surveysTable)
        .set({
          // 테스트 모드를 켠 설문이다 — 그래도 클라이언트가 보는 것은 실 파티션이어야 한다.
          testModeEnabled: true,
          contactColumns: {
            version: 1,
            headerRow: 1,
            columns: [
              { key: 'resid', label: '시스템ID', source: 'system.resid', order: 0 },
              { key: '기관명', label: '기관명', source: 'attrs.기관명', order: 1 },
              { key: '연락처', label: '연락처', source: 'pii.연락처', order: 2, piiType: 'phone' },
              { key: 'mail', label: '메일', source: 'system.email_count', order: 3 },
            ],
          },
        })
        .where(eq(surveysTable.id, surveyId));

      targetId = crypto.randomUUID();
      await db.insert(contactTargetsTable).values({
        id: targetId,
        surveyId,
        resid: 1,
        isTest: false,
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

    it('관문을 지난 화면이 읽는 표에 원문·암호문·초대 토큰·컨택 id·메일 열이 없다', async () => {
      const { token } = await issueAndEnter();
      await admin.accessLinks.setClientTab({ surveyId, tab: 'contactsMasked', enabled: true });
      const viewer = await assertClientLinkPageAccess(token, 'contactsMasked');
      const [stored] = await db
        .select({ inviteToken: contactTargetsTable.inviteToken })
        .from(contactTargetsTable)
        .where(eq(contactTargetsTable.id, targetId));

      // 화면이 하는 것과 같은 호출이다 — 관문이 돌려준 설문 id 로 읽는다.
      const page = await listGuestContacts(viewer.surveyId, 1);
      const serialized = JSON.stringify(page);

      expect(page.columns).toEqual(['시스템ID', '기관명', '연락처']);
      // 실 파티션의 행이 보인다(테스트 모드와 무관) — 마스킹 힌트와 일반 attrs 만.
      expect(page.rows[0]?.cells).toEqual(expect.arrayContaining(['한국물류협회', '010-****-5678']));
      expect(serialized).not.toContain('ciphertext-not-read-by-list');
      expect(serialized).not.toContain(stored?.inviteToken ?? 'no-token');
      expect(serialized).not.toContain(targetId);
    });
  });
});
