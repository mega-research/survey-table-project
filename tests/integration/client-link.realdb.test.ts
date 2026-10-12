/**
 * 클라이언트 링크의 세션 — 접속부터 닫힘까지 (ADR-0029·0030) — 실 로컬 DB.
 *
 * 형제 `fieldwork-link.realdb.test.ts` 가 링크 행의 수명(발급·종류별 공존·탭 저장)을 지고,
 * 이 파일은 **클라이언트 링크로 들어온 사람에게 무엇이 보이는가**를 진다. 실 DB 인 이유는
 * 같다 — 종류 칸막이는 WHERE 이고, 닫힘은 설문 상태 조인이고, 세션 폐기는 컬럼 값의
 * 대조다. 목은 테스트가 정한 행을 돌려주므로 셋 다 무엇이든 통과한다.
 *
 * 축 여섯.
 *  ① 접속 — 맞는 비밀번호가 클라이언트 주체를 세우고, 쿠키가 **자기 콘솔 경로**에만 실린다.
 *  ② 입구 화면 — 조사 이름이 어떤 상태에서도 실리지 않는다.
 *  ③ 종류 칸막이 — 외주 링크의 토큰은 클라이언트 입구에서 없는 토큰이고, 클라이언트 쿠키의
 *     값을 외주 이름으로 바꿔 보내도 scoped 표면이 열리지 않는다.
 *  ④ 닫힘 — **중단에는 열려 있고** 종료·삭제·배치 대기·링크 종료에 닫힌다. 종료 취소와
 *     재발행은 같은 주소·같은 쿠키로 다시 연다.
 *  ⑤ 세션 폐기 — 비밀번호를 바꾸면 선 세션이 끊긴다.
 *  ⑥ 탭 — 연구원이 바꾸면 **같은 쿠키의 다음 요청**부터 반영된다.
 *  ⑦ 공존과 파티션 — 한 브라우저의 여러 세션이 섞이지 않고, 테스트 모드와 무관하게 real 이다.
 */
import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { readFieldworkLinkSessions } from '@/lib/auth/access-link-session';
import {
  authenticateAccessLink,
  authenticateClientLink,
  resolveClientLinkActor,
  resolveClientLinkEntry,
  resolveLinkActor,
} from '@/server/access-link';
import type { ORPCContext } from '@/server/context';
import { loadOperationsDataScope } from '@/server/data-scope';
import { setClosed } from '@/server/operations/services/control';
import { router } from '@/server/router';
import { loadSurveyAccess } from '@/server/survey-access';
import { accessLinks } from '@/server/workspace/procedures/access-links';
import { SCOPED_INPUTS, SCOPED_PATHS } from '@tests/helpers/scoped-surface-inputs';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const OWNER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();
const SURVEY_TITLE = '고객사 비공개 조사';
const PASSWORD = 'ClientPw2026';

const OVERVIEW_ONLY = { overview: true, progressReport: false, contactsMasked: false, quota: false };

let surveyId = '';

const admin = createRouterClient(
  { accessLinks },
  {
    context: {
      db,
      user: {
        id: OWNER_ID,
        email: `client-link-${OWNER_ID}@example.com`,
        name: '링크발급자',
        status: 'active',
        isSuperadmin: false,
        userType: 'internal',
      },
    } satisfies ORPCContext,
  },
);

function cookieHeaders(...cookies: Array<{ name: string; value: string }>): Headers {
  return new Headers({ cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') });
}

/** 클라이언트 링크를 발급하고 접속까지 마친 세션 하나. */
async function issueAndSignIn() {
  const { link } = await admin.accessLinks.issue({ surveyId, kind: 'client', password: PASSWORD });
  const auth = await authenticateClientLink(link.token, PASSWORD);
  if (!auth.ok) throw new Error(`접속 실패: ${auth.reason}`);
  return { token: link.token, linkId: link.id, cookie: auth.cookie };
}

describe.skipIf(!isLocalDb)('클라이언트 링크 세션 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values({
      id: OWNER_ID,
      name: '링크발급자',
      email: `client-link-${OWNER_ID}@example.com`,
      emailVerified: true,
      status: 'active',
      userType: 'internal',
    });
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `클라링크팀-${TEAM_ID.slice(0, 8)}` });
    await db
      .insert(teamMembersTable)
      .values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'leader' });
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    // 설문을 지우면 링크는 CASCADE 로 함께 사라진다 — 매 테스트가 빈 상태에서 시작한다.
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    surveyId = crypto.randomUUID();
    await db.insert(surveysTable).values({
      id: surveyId,
      title: SURVEY_TITLE,
      status: 'published',
      teamId: TEAM_ID,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
    });
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    await db.delete(teamMembersTable).where(eq(teamMembersTable.teamId, TEAM_ID));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(eq(usersTable.id, OWNER_ID));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 접속
  // ───────────────────────────────────────────────────────────────────────────

  it('맞는 비밀번호가 그 설문의 클라이언트 주체를 세운다 — 탭은 링크 행의 것이다', async () => {
    const { token, linkId, cookie } = await issueAndSignIn();
    expect(await resolveClientLinkActor(token, cookieHeaders(cookie))).toEqual({
      ok: true,
      actor: {
        kind: 'link',
        linkId,
        surveyId,
        linkKind: 'client',
        clientTabs: OVERVIEW_ONLY,
      },
    });
  });

  it('쿠키가 자기 콘솔 경로에만 실린다 — RPC 주소에는 따라가지 않는다', async () => {
    const { token, cookie } = await issueAndSignIn();
    expect(cookie.name).toBe(`cl_${token}`);
    expect(cookie.path).toBe(`/client/${token}`);
  });

  it('없는 토큰과 틀린 비밀번호가 같은 답이다', async () => {
    const { token } = await issueAndSignIn();
    const wrong = await authenticateClientLink(token, 'WrongPw2026');
    const missing = await authenticateClientLink('noSuchToken_0123456789', PASSWORD);
    expect(wrong).toEqual({ ok: false, reason: 'denied' });
    expect(missing).toEqual(wrong);
  });

  it('세션이 설문의 현황 열람 둘만 연다', async () => {
    const { token, cookie } = await issueAndSignIn();
    const resolved = await resolveClientLinkActor(token, cookieHeaders(cookie));
    if (!resolved.ok) throw new Error('세션이 서지 않았다');

    const access = await loadSurveyAccess(resolved.actor, surveyId);
    expect([...access.capabilities].sort()).toEqual(['operations.view', 'survey.view']);
    expect(access.guestTabs).toEqual(OVERVIEW_ONLY);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 입구 화면 — 조사 이름이 없다
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 외주 입구와 일부러 다른 지점이다. 토큰만 가진 사람에게 무슨 조사인지 알려 줄 이유가
   * 없다 — 직렬화 결과 **어디에도** 제목이 없음을 본다(필드 하나만 보면 다른 필드로 샌다).
   */
  it('비밀번호 화면에 조사 이름이 실리지 않는다', async () => {
    const { token } = await issueAndSignIn();
    const entry = await resolveClientLinkEntry(token, new Headers());
    expect(entry).toEqual({ kind: 'password' });
    expect(JSON.stringify(entry)).not.toContain(SURVEY_TITLE);
  });

  it('없는 토큰도 같은 비밀번호 화면이다', async () => {
    expect(await resolveClientLinkEntry('noSuchToken_0123456789', new Headers())).toEqual({
      kind: 'password',
    });
  });

  it('접속된 세션은 허용된 탭과 함께 나온다 — 입구가 첫 화면을 고르는 재료다', async () => {
    const { token, cookie } = await issueAndSignIn();
    expect(await resolveClientLinkEntry(token, cookieHeaders(cookie))).toEqual({
      kind: 'authenticated',
      tabs: OVERVIEW_ONLY,
    });
  });

  it('닫힘 화면에도 조사 이름이 실리지 않는다', async () => {
    const { token } = await issueAndSignIn();
    await setClosed({ surveyId, isClosed: true });
    const entry = await resolveClientLinkEntry(token, new Headers());
    expect(entry).toEqual({ kind: 'closed' });
    expect(JSON.stringify(entry)).not.toContain(SURVEY_TITLE);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 종류 칸막이
  // ───────────────────────────────────────────────────────────────────────────

  it('외주 실사 링크의 토큰과 비밀번호로는 클라이언트 입구가 열리지 않는다', async () => {
    const { link, password } = await admin.accessLinks.issue({ surveyId, kind: 'fieldwork' });
    // 대조군 — 자기 입구에서는 열린다.
    expect((await authenticateAccessLink(link.token, password)).ok).toBe(true);

    expect(await authenticateClientLink(link.token, password)).toEqual({
      ok: false,
      reason: 'denied',
    });
    expect(await resolveClientLinkActor(link.token, new Headers())).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(await resolveClientLinkEntry(link.token, new Headers())).toEqual({ kind: 'password' });
  });

  it('클라이언트 쿠키를 외주 세션 자리에 들고 와도 외주 콘솔이 열리지 않는다', async () => {
    const { token, cookie } = await issueAndSignIn();
    // 이름을 그대로 둔 것, 그리고 값만 외주 이름으로 옮긴 것 — 둘 다.
    for (const forged of [cookie, { name: `fw_${token}`, value: cookie.value }]) {
      expect(await resolveLinkActor(token, cookieHeaders(forged))).toEqual({
        ok: false,
        reason: 'unknown',
      });
    }
  });

  /**
   * 클라이언트 세션이 scoped 표면에 닿지 못하는 이유는 둘이다 — 쿠키가 RPC 주소에 실리지
   * 않고(경로), 실려도 세션 목록에 서지 않는다(접두). 여기서는 **둘 다 뚫렸다고 치고**
   * 세 번째 자물쇠를 본다: 값을 외주 이름으로 바꿔 세션 목록에 세워도, 그 토큰의 행이 외주
   * 종류가 아니라 세션이 무효다. 「열린 표면 0」이 구성이 아니라 판정으로도 참이다.
   */
  it.each(SCOPED_PATHS)('%s 는 클라이언트 세션으로 열리지 않는다', async (path) => {
    const { token, cookie } = await issueAndSignIn();
    const forged = cookieHeaders({ name: `fw_${token}`, value: cookie.value });
    const sessions = readFieldworkLinkSessions(forged);
    // 위조가 실제로 세션 목록까지 올라갔다 — 그렇지 않으면 아래 거부가 다른 이유로 난다.
    expect(sessions.map((s) => s.claim.surveyId)).toEqual([surveyId]);

    const client = createRouterClient(router, {
      context: { db, user: null, headers: forged, linkSessions: sessions } satisfies ORPCContext,
    });
    const call = path
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], client) as (
      input: unknown,
    ) => Promise<unknown>;

    await expect(call({ surveyId, ...SCOPED_INPUTS[path] })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 닫힘 — 중단에는 열려 있고 종료에 닫힌다
  // ───────────────────────────────────────────────────────────────────────────

  it('설문을 중단해도 열려 있다 — 같은 설문의 외주 링크는 닫힌다', async () => {
    const { token, cookie } = await issueAndSignIn();
    const fieldwork = await admin.accessLinks.issue({ surveyId, kind: 'fieldwork' });
    const fieldworkAuth = await authenticateAccessLink(fieldwork.link.token, fieldwork.password);
    if (!fieldworkAuth.ok) throw new Error('외주 링크 접속 실패');

    await db.update(surveysTable).set({ isPaused: true }).where(eq(surveysTable.id, surveyId));

    // 클라이언트 — 선 세션도, 새 접속도, 판정도 그대로다.
    const resolved = await resolveClientLinkActor(token, cookieHeaders(cookie));
    expect(resolved).toMatchObject({ ok: true });
    expect((await authenticateClientLink(token, PASSWORD)).ok).toBe(true);
    if (!resolved.ok) throw new Error('세션이 서지 않았다');
    expect((await loadSurveyAccess(resolved.actor, surveyId)).capabilities.has('operations.view')).toBe(
      true,
    );
    // 외주 — 같은 순간 닫혀 있다. 이 대비가 「중단은 실사만 멈춘다」의 관찰 가능한 형태다.
    expect(
      await resolveLinkActor(fieldwork.link.token, cookieHeaders(fieldworkAuth.cookie)),
    ).toEqual({ ok: false, reason: 'closed' });
  });

  it('설문 종료가 닫고, 종료를 취소하면 같은 주소·같은 쿠키로 다시 열린다', async () => {
    const { token, cookie } = await issueAndSignIn();
    const headers = cookieHeaders(cookie);

    await setClosed({ surveyId, isClosed: true });
    expect(await resolveClientLinkActor(token, headers)).toEqual({ ok: false, reason: 'closed' });
    expect(await authenticateClientLink(token, PASSWORD)).toEqual({ ok: false, reason: 'closed' });

    await setClosed({ surveyId, isClosed: false });
    expect(await resolveClientLinkActor(token, headers)).toMatchObject({ ok: true });
  });

  it('종료한 설문을 다시 발행하면 같은 주소·같은 쿠키로 다시 열린다', async () => {
    const { token, cookie } = await issueAndSignIn();
    await setClosed({ surveyId, isClosed: true });
    // 재발행이 하는 일은 상태를 published 로 되돌리는 것이다(발행 서비스의 계약).
    await db.update(surveysTable).set({ status: 'published' }).where(eq(surveysTable.id, surveyId));
    expect(await resolveClientLinkActor(token, cookieHeaders(cookie))).toMatchObject({ ok: true });
  });

  it('종료된 설문에서는 선 세션의 판정도 비어 있다 — 세션과 capability 가 함께 닫힌다', async () => {
    const { token, cookie } = await issueAndSignIn();
    const resolved = await resolveClientLinkActor(token, cookieHeaders(cookie));
    if (!resolved.ok) throw new Error('세션이 서지 않았다');

    await setClosed({ surveyId, isClosed: true });
    // 세션 판정을 건너뛰고 주체를 그대로 들고 와도 판정 코어가 닫는다.
    const access = await loadSurveyAccess(resolved.actor, surveyId);
    expect([...access.capabilities]).toEqual([]);
  });

  it('soft delete 된 설문의 링크는 닫힌다', async () => {
    const { token, cookie } = await issueAndSignIn();
    await db
      .update(surveysTable)
      .set({ deletedAt: new Date() })
      .where(eq(surveysTable.id, surveyId));
    expect(await resolveClientLinkActor(token, cookieHeaders(cookie))).toEqual({
      ok: false,
      reason: 'closed',
    });
    expect(await resolveClientLinkEntry(token, new Headers())).toEqual({ kind: 'closed' });
  });

  it('배치 대기 설문의 링크는 닫힌다', async () => {
    const { token, cookie } = await issueAndSignIn();
    await db
      .update(surveysTable)
      .set({ teamId: null, assignmentStatus: 'assignment_pending' })
      .where(eq(surveysTable.id, surveyId));
    expect(await resolveClientLinkActor(token, cookieHeaders(cookie))).toEqual({
      ok: false,
      reason: 'closed',
    });
  });

  it('링크를 종료하면 닫히고, 같은 설문의 외주 링크는 살아 있다', async () => {
    const { token, cookie } = await issueAndSignIn();
    const fieldwork = await admin.accessLinks.issue({ surveyId, kind: 'fieldwork' });

    await admin.accessLinks.close({ surveyId, kind: 'client' });
    expect(await resolveClientLinkActor(token, cookieHeaders(cookie))).toEqual({
      ok: false,
      reason: 'closed',
    });
    expect((await authenticateAccessLink(fieldwork.link.token, fieldwork.password)).ok).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑤ 세션 폐기
  // ───────────────────────────────────────────────────────────────────────────

  it('비밀번호를 바꾸면 이미 들어와 있던 세션이 그 순간 끊긴다', async () => {
    const { token, cookie } = await issueAndSignIn();
    const headers = cookieHeaders(cookie);
    expect(await resolveClientLinkActor(token, headers)).toMatchObject({ ok: true });

    await admin.accessLinks.resetPassword({ surveyId, kind: 'client', password: 'NextPw2026' });
    expect(await resolveClientLinkActor(token, headers)).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
    // 닫힌 것이 아니다 — 새 비밀번호로 다시 들어온다.
    expect(await resolveClientLinkEntry(token, headers)).toEqual({ kind: 'password' });
    expect((await authenticateClientLink(token, 'NextPw2026')).ok).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑥ 탭
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 탭이 쿠키에 실려 있었다면 이 테스트가 빨개진다 — 같은 쿠키로 다시 물었는데 답이
   * 바뀌어야 한다. 연구원이 화면을 닫았는데 클라이언트가 12시간 동안 계속 보는 일을 막는다.
   */
  it('연구원이 탭을 바꾸면 같은 쿠키의 다음 요청부터 반영된다', async () => {
    const { token, cookie } = await issueAndSignIn();
    const headers = cookieHeaders(cookie);
    const widened = { overview: true, progressReport: true, contactsMasked: false, quota: true };

    await admin.accessLinks.setClientTabs({ surveyId, tabs: widened });
    const afterWiden = await resolveClientLinkActor(token, headers);
    if (!afterWiden.ok) throw new Error('세션이 서지 않았다');
    expect((await loadSurveyAccess(afterWiden.actor, surveyId)).guestTabs).toEqual(widened);

    const narrowed = { overview: false, progressReport: false, contactsMasked: false, quota: false };
    await admin.accessLinks.setClientTabs({ surveyId, tabs: narrowed });
    const afterNarrow = await resolveClientLinkActor(token, headers);
    if (!afterNarrow.ok) throw new Error('세션이 서지 않았다');
    const access = await loadSurveyAccess(afterNarrow.actor, surveyId);
    expect(access.guestTabs).toEqual(narrowed);
    // 탭을 전부 꺼도 capability 는 그대로다 — 미리보기는 화이트리스트 밖이다.
    expect([...access.capabilities].sort()).toEqual(['operations.view', 'survey.view']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑦ 공존과 파티션
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 한 설문에 두 종류의 링크가 함께 서므로 한 브라우저가 같은 설문의 두 쿠키를 들 수 있다
   * (연구원이 둘 다 눌러 본 브라우저가 실제 상황이다). scoped 베이스는 설문 id 로 세션을
   * 고르는데, 두 쿠키가 한 목록에 서면 판정이 쿠키 순서에 달린다 — 순서를 양쪽으로 두드린다.
   */
  it('같은 설문의 외주 세션과 함께 있어도 외주의 scoped 표면이 종전대로 열린다', async () => {
    const mine = await issueAndSignIn();
    const fieldwork = await admin.accessLinks.issue({ surveyId, kind: 'fieldwork' });
    const fieldworkAuth = await authenticateAccessLink(fieldwork.link.token, fieldwork.password);
    if (!fieldworkAuth.ok) throw new Error('외주 링크 접속 실패');

    for (const order of [
      [mine.cookie, fieldworkAuth.cookie],
      [fieldworkAuth.cookie, mine.cookie],
    ]) {
      const headers = cookieHeaders(...order);
      const both = createRouterClient(router, {
        context: {
          db,
          user: null,
          headers,
          linkSessions: readFieldworkLinkSessions(headers),
        } satisfies ORPCContext,
      });
      await expect(
        both.contacts.idLists.create({ surveyId, ...SCOPED_INPUTS['contacts.idLists.create'] } as never),
      ).resolves.toBeDefined();
      // 클라이언트 세션도 자기 입구에서 그대로 선다.
      expect(await resolveClientLinkActor(mine.token, headers)).toMatchObject({ ok: true });
    }
  });

  it('여러 설문의 클라이언트 링크를 한 브라우저에서 열어도 섞이지 않는다', async () => {
    const mine = await issueAndSignIn();
    const neighbourId = crypto.randomUUID();
    await db.insert(surveysTable).values({
      id: neighbourId,
      title: '이웃 조사',
      status: 'published',
      teamId: TEAM_ID,
      visibility: 'team',
      assignmentStatus: 'assigned',
      ownerUserId: OWNER_ID,
      createdBy: OWNER_ID,
    });
    try {
      const { link } = await admin.accessLinks.issue({
        surveyId: neighbourId,
        kind: 'client',
        password: PASSWORD,
      });
      const neighbourAuth = await authenticateClientLink(link.token, PASSWORD);
      if (!neighbourAuth.ok) throw new Error('이웃 링크 접속 실패');

      const headers = cookieHeaders(mine.cookie, neighbourAuth.cookie);
      expect(await resolveClientLinkActor(mine.token, headers)).toMatchObject({
        ok: true,
        actor: { surveyId },
      });
      expect(await resolveClientLinkActor(link.token, headers)).toMatchObject({
        ok: true,
        actor: { surveyId: neighbourId },
      });
      // 이웃 쿠키만 들고 내 주소를 열면 접속 전이다 — 값을 내 이름으로 옮겨도 링크 id 가 다르다.
      const swapped = cookieHeaders({ name: mine.cookie.name, value: neighbourAuth.cookie.value });
      expect(await resolveClientLinkActor(mine.token, swapped)).toEqual({
        ok: false,
        reason: 'unauthenticated',
      });
    } finally {
      await db.delete(surveysTable).where(eq(surveysTable.id, neighbourId));
    }
  });

  it('테스트 모드를 켠 설문에서도 실 파티션을 본다', async () => {
    await db
      .update(surveysTable)
      .set({ testModeEnabled: true })
      .where(eq(surveysTable.id, surveyId));
    const { token, cookie } = await issueAndSignIn();
    const resolved = await resolveClientLinkActor(token, cookieHeaders(cookie));
    if (!resolved.ok) throw new Error('세션이 서지 않았다');

    // 담당 연구원은 test 를 보는 설문이다 — 그 상태에서 클라이언트가 test 를 보면 고객사가
    // 연습용 숫자를 실적으로 읽는다.
    expect(await loadOperationsDataScope(surveyId, resolved.actor)).toBe('real');
    expect(
      await loadOperationsDataScope(surveyId, {
        id: OWNER_ID,
        isSuperadmin: false,
        userType: 'internal',
      }),
    ).toBe('test');
  });
});
