/**
 * 외주 실사 링크의 수명 — 발급부터 종료까지 (ADR-0026, 티켓 04·05) — 실 로컬 DB.
 *
 * **실 DB 인 이유**가 이 파일의 존재 근거다. 여기서 지키는 불변식은 전부 목이 무엇이든
 * 통과시키는 종류다.
 *  - 비밀번호의 **가역 복호** — 목은 암호화를 하지 않으므로 「해시가 아니다」가 증명되지 않는다.
 *  - **부분 UNIQUE**(`WHERE closed_at IS NULL`) — 「설문당 활성 링크 하나」와 「종료 뒤 재발급」이
 *    같은 제약의 양면인데, 목에는 제약이 없어 둘 다 그냥 성공한다.
 *  - **세션 폐기 표식** — 쿠키의 `password_updated_at` 과 DB 값의 대조이고, 목은 테스트가 정한
 *    행을 돌려주므로 UPDATE 가 실제로 그 컬럼을 올렸는지 알 수 없다.
 *  - **설문 상태 조인** — 중단·삭제·배치 대기가 링크를 닫는 것은 WHERE/JOIN 의 일이다.
 *
 * 축 다섯.
 *  ① 발급 왕복 — 설문당 하나, 토큰 길이·유일성, 저장한 비밀번호를 그대로 다시 읽는다.
 *  ② 접속 — 맞으면 쿠키가 서고, 없는 토큰과 틀린 비밀번호가 **같은 답**이다.
 *  ③ 칸막이 — 여러 설문의 링크 세션이 서로를 열지 않는다.
 *  ④ 닫힘과 재개 — 중단·삭제·배치 대기·종료가 닫고, **중단은 재개하면 같은 주소로 열린다**
 *     (만료가 아니라 「중단 중 차단」이라는 것의 관찰 가능한 형태).
 *  ⑤ 비밀번호 변경이 **선 세션을 끊는다**.
 *  ⑥ 콘솔 축 (티켓 06) — **사유의 대비**(자기 설문=FORBIDDEN ↔ 타 설문=NOT_FOUND)와
 *     **파티션 고정**(테스트 모드를 켠 설문에서도 real 을 읽고 real 에 쓴다).
 *  ⑦ 귀속 축 (티켓 08) — 링크가 남긴 회차는 **링크 칸**에 찍히고 계정 칸은 빈다. 배타
 *     CHECK 가 둘 다 채운 INSERT 를 거부하고, 귀속이 남은 링크는 **종료돼도 지워지지 않는다**.
 */
import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  contactAttempts as attemptsTable,
  contactTargets as contactTargetsTable,
  surveyFieldworkLinks as linksTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import {
  fieldworkLinkCookieName,
  readFieldworkLinkSessions,
} from '@/lib/auth/fieldwork-link-session';
import type { ORPCContext } from '@/server/context';
import {
  authenticateFieldworkLink,
  resolveFieldworkLinkEntry,
  resolveLinkActor,
} from '@/server/fieldwork-link';
import { loadOperationsDataScope } from '@/server/data-scope';
import { setClosed } from '@/server/operations/services/control';
import { loadContactsListPage } from '@/server/read-models/contacts-list-page';
import { router } from '@/server/router';
import { attempts } from '@/server/contacts/procedures/attempts';
import { fieldworkLinks } from '@/server/workspace/procedures/fieldwork-links';
import {
  LINK_BLOCKED_SCOPED_PATHS,
  LINK_OPEN_SCOPED_PATHS,
  SCOPED_INPUTS,
} from '@tests/helpers/scoped-surface-inputs';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const OWNER_ID = crypto.randomUUID();
const TEAM_ID = crypto.randomUUID();

let surveyId = '';
/** 칸막이 검증용 이웃 설문 — 같은 팀, 자기 링크를 따로 갖는다. */
let neighbourSurveyId = '';

const client = createRouterClient(
  { fieldworkLinks },
  {
    context: {
      db,
      user: {
        id: OWNER_ID,
        email: `fw-link-${OWNER_ID}@example.com`,
        name: '링크발급자',
        status: 'active',
        isSuperadmin: false,
        userType: 'internal',
      },
    } satisfies ORPCContext,
  },
);

/** 접속 성공 쿠키를 요청 헤더 모양으로 — 브라우저가 다음 요청에 실어 보내는 것과 같다. */
function cookieHeaders(...cookies: Array<{ name: string; value: string }>): Headers {
  return new Headers({ cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') });
}

async function seedSurvey(title: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id,
    title,
    teamId: TEAM_ID,
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: OWNER_ID,
    createdBy: OWNER_ID,
  });
  return id;
}

/** 링크를 발급하고 접속까지 마친 세션 하나 — 축 대부분의 출발점이다. */
async function issueAndSignIn(target = surveyId) {
  const { link, password } = await client.fieldworkLinks.issue({ surveyId: target });
  const auth = await authenticateFieldworkLink(link.token, password);
  if (!auth.ok) throw new Error(`접속 실패: ${auth.reason}`);
  return { token: link.token, password, linkId: link.id, cookie: auth.cookie };
}

describe.skipIf(!isLocalDb)('외주 실사 링크 수명 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values({
      id: OWNER_ID,
      name: '링크발급자',
      email: `fw-link-${OWNER_ID}@example.com`,
      emailVerified: true,
      status: 'active',
      userType: 'internal',
    });
    await db.insert(teamsTable).values({ id: TEAM_ID, name: `링크팀-${TEAM_ID.slice(0, 8)}` });
    await db
      .insert(teamMembersTable)
      .values({ teamId: TEAM_ID, userId: OWNER_ID, role: 'leader' });
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    // 설문을 지우면 링크는 CASCADE 로 함께 사라진다(0126) — 매 테스트가 빈 상태에서 시작한다.
    for (const id of [surveyId, neighbourSurveyId]) {
      if (id) await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
    surveyId = await seedSurvey('외주 실사 조사');
    neighbourSurveyId = await seedSurvey('이웃 조사');
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    for (const id of [surveyId, neighbourSurveyId]) {
      if (id) await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
    await db.delete(teamMembersTable).where(eq(teamMembersTable.teamId, TEAM_ID));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_ID));
    await db.delete(usersTable).where(eq(usersTable.id, OWNER_ID));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 발급 왕복
  // ───────────────────────────────────────────────────────────────────────────

  it('발급이 추측 저항적인 토큰과 평문 비밀번호를 한 번 돌려준다', async () => {
    const { link, password } = await client.fieldworkLinks.issue({ surveyId });
    // 길이는 코드가 정한다 — 와이어프레임의 8자 예시는 그림이다(PRD Further Notes).
    expect(link.token.length).toBeGreaterThanOrEqual(16);
    expect(password.length).toBeGreaterThanOrEqual(8);
    expect(await client.fieldworkLinks.get({ surveyId })).toMatchObject({
      link: { token: link.token },
      canManage: true,
    });
  });

  it('저장한 비밀번호를 그대로 다시 읽는다 — 해시가 아니라 가역 암호화다', async () => {
    const { password } = await client.fieldworkLinks.issue({ surveyId, password: 'Hanbit2026!' });
    expect(password).toBe('Hanbit2026!');
    // 연구원이 업체에 답해 줘야 하므로 되읽기가 기능이다. 해시였다면 이 단언이 불가능하다.
    expect(await client.fieldworkLinks.revealPassword({ surveyId })).toEqual({
      password: 'Hanbit2026!',
    });
    // 저장된 것은 평문이 아니다 — 컬럼을 직접 본다.
    const [row] = await db
      .select({ cipher: linksTable.passwordCipher })
      .from(linksTable)
      .where(eq(linksTable.surveyId, surveyId));
    expect(row?.cipher).not.toContain('Hanbit2026!');
  });

  it('활성 링크는 설문당 하나다 — 두 번째 발급은 CONFLICT', async () => {
    await client.fieldworkLinks.issue({ surveyId });
    await expect(client.fieldworkLinks.issue({ surveyId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('설문마다 다른 토큰이 난다', async () => {
    const a = await client.fieldworkLinks.issue({ surveyId });
    const b = await client.fieldworkLinks.issue({ surveyId: neighbourSurveyId });
    expect(a.link.token).not.toBe(b.link.token);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② 접속
  // ───────────────────────────────────────────────────────────────────────────

  it('맞는 비밀번호가 그 설문의 링크 주체를 세운다', async () => {
    const { token, cookie, linkId } = await issueAndSignIn();
    const result = await resolveLinkActor(token, cookieHeaders(cookie));
    expect(result).toEqual({ ok: true, actor: { kind: 'link', linkId, surveyId } });
  });

  it('없는 토큰과 틀린 비밀번호가 같은 답이다 — 주소 스캔이 존재를 확인하지 못한다', async () => {
    const { token } = await issueAndSignIn();
    const wrong = await authenticateFieldworkLink(token, '전혀아닌비밀번호');
    const unknown = await authenticateFieldworkLink('zzzzzzzzzzzzzzzz', 'anything');
    expect(wrong).toEqual({ ok: false, reason: 'denied' });
    expect(unknown).toEqual(wrong);
  });

  it('쿠키가 없으면 비밀번호 화면이고 조사 이름이 보인다', async () => {
    const { token } = await issueAndSignIn();
    expect(await resolveFieldworkLinkEntry(token, new Headers())).toEqual({
      kind: 'password',
      surveyTitle: '외주 실사 조사',
    });
  });

  it('없는 토큰도 같은 비밀번호 화면이다 — 조사 이름만 없다', async () => {
    expect(await resolveFieldworkLinkEntry('zzzzzzzzzzzzzzzz', new Headers())).toEqual({
      kind: 'password',
      surveyTitle: null,
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ 칸막이 — 두 조사를 병행한다
  // ───────────────────────────────────────────────────────────────────────────

  it('한 브라우저의 두 링크 세션이 서로 섞이지 않는다', async () => {
    const a = await issueAndSignIn(surveyId);
    const b = await issueAndSignIn(neighbourSurveyId);
    const both = cookieHeaders(a.cookie, b.cookie);

    expect(await resolveLinkActor(a.token, both)).toMatchObject({
      ok: true,
      actor: { surveyId },
    });
    expect(await resolveLinkActor(b.token, both)).toMatchObject({
      ok: true,
      actor: { surveyId: neighbourSurveyId },
    });
  });

  it('이웃 설문의 쿠키로는 이 링크가 열리지 않는다', async () => {
    const a = await issueAndSignIn(surveyId);
    const b = await issueAndSignIn(neighbourSurveyId);
    // 쿠키 이름은 토큰별이라 이름만 갈아 붙이는 것이 유일한 시도다 — 서명이 그것을 막는다.
    const forged = { name: fieldworkLinkCookieName(a.token), value: b.cookie.value };
    expect(await resolveLinkActor(a.token, cookieHeaders(forged))).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 닫힘과 재개
  // ───────────────────────────────────────────────────────────────────────────

  it('설문 중단이 링크를 닫고, 재개하면 같은 주소·같은 쿠키로 다시 열린다', async () => {
    const { token, cookie } = await issueAndSignIn();
    const headers = cookieHeaders(cookie);

    await db.update(surveysTable).set({ isPaused: true }).where(eq(surveysTable.id, surveyId));
    expect(await resolveLinkActor(token, headers)).toEqual({ ok: false, reason: 'closed' });
    expect(await resolveFieldworkLinkEntry(token, headers)).toEqual({
      kind: 'closed',
      surveyTitle: '외주 실사 조사',
    });

    // 만료가 아니라 「중단 중 차단」이다 — 재개는 비밀번호도 토큰도 건드리지 않는다.
    await db.update(surveysTable).set({ isPaused: false }).where(eq(surveysTable.id, surveyId));
    expect(await resolveLinkActor(token, headers)).toMatchObject({ ok: true });
  });

  it('중단 중에는 비밀번호가 맞아도 닫힘이다 — 접속으로 뚫리지 않는다', async () => {
    const { token, password } = await issueAndSignIn();
    await db.update(surveysTable).set({ isPaused: true }).where(eq(surveysTable.id, surveyId));
    expect(await authenticateFieldworkLink(token, password)).toEqual({
      ok: false,
      reason: 'closed',
    });
  });

  // 설문 종료(ADR-0030) — 닫는 모양은 중단과 같고 뜻이 다르다. 중단은 「잠깐 멈춤」이고
  // 종료는 「조사가 끝나 외부 접근을 전부 닫는다」다. 둘 다 링크 행을 건드리지 않는다.

  it('설문 종료가 링크를 닫고, 종료를 취소하면 같은 주소·같은 쿠키로 다시 열린다', async () => {
    const { token, cookie, linkId } = await issueAndSignIn();
    const headers = cookieHeaders(cookie);
    await db.update(surveysTable).set({ status: 'published' }).where(eq(surveysTable.id, surveyId));
    const [linkBefore] = await db
      .select()
      .from(linksTable)
      .where(eq(linksTable.id, linkId));

    await setClosed({ surveyId, isClosed: true });
    expect(await resolveLinkActor(token, headers)).toEqual({ ok: false, reason: 'closed' });
    expect(await resolveFieldworkLinkEntry(token, headers)).toEqual({
      kind: 'closed',
      surveyTitle: '외주 실사 조사',
    });
    // 종료는 링크 행을 건드리지 않는다 — 닫힘은 설문 상태에서 파생된다. 행의 closed_at 은
    // 「이 링크만 닫는다」로 남고, 비밀번호 표식이 그대로라 선 세션이 폐기되지도 않는다.
    const [linkAfter] = await db.select().from(linksTable).where(eq(linksTable.id, linkId));
    expect(linkAfter).toEqual(linkBefore);

    await setClosed({ surveyId, isClosed: false });
    expect(await resolveLinkActor(token, headers)).toMatchObject({ ok: true });
  });

  it('종료된 설문에서는 비밀번호가 맞아도 닫힘이다 — 접속으로 뚫리지 않는다', async () => {
    const { token, password } = await issueAndSignIn();
    await db.update(surveysTable).set({ status: 'closed' }).where(eq(surveysTable.id, surveyId));
    expect(await authenticateFieldworkLink(token, password)).toEqual({
      ok: false,
      reason: 'closed',
    });
  });

  it('종료하면 이미 들어와 있던 세션의 요청이 다음부터 막힌다', async () => {
    // 세션 판정만 닫히고 capability 판정이 열려 있으면(또는 그 반대면) 선 세션이 계속
    // 움직인다. 링크에게 열린 표면 하나를 실제로 불러 두 판정이 함께 닫혔음을 본다.
    const { cookie } = await issueAndSignIn();
    const call = callerFor(linkClientFor(cookie), 'contacts.idLists.create');
    const input = { surveyId, ...SCOPED_INPUTS['contacts.idLists.create'] };
    await expect(call(input)).resolves.toBeDefined();

    await db.update(surveysTable).set({ status: 'closed' }).where(eq(surveysTable.id, surveyId));
    await expect(call(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('soft delete 된 설문의 링크는 닫힌다', async () => {
    const { token, cookie } = await issueAndSignIn();
    await db
      .update(surveysTable)
      .set({ deletedAt: new Date() })
      .where(eq(surveysTable.id, surveyId));
    expect(await resolveLinkActor(token, cookieHeaders(cookie))).toEqual({
      ok: false,
      reason: 'closed',
    });
  });

  it('배치 대기 설문의 링크는 닫힌다 — 팀이 정해지기 전에는 아무도 못 연다', async () => {
    const { token, cookie } = await issueAndSignIn();
    await db
      .update(surveysTable)
      .set({ teamId: null, assignmentStatus: 'assignment_pending' })
      .where(eq(surveysTable.id, surveyId));
    expect(await resolveLinkActor(token, cookieHeaders(cookie))).toEqual({
      ok: false,
      reason: 'closed',
    });
  });

  it('종료는 행 삭제가 아니라 closedAt 이고, 그 뒤 재발급이 된다', async () => {
    const first = await issueAndSignIn();
    await client.fieldworkLinks.close({ surveyId });

    // 옛 토큰은 「없는 토큰」이 아니라 「닫힘」이다 — 외주가 비밀번호를 다시 넣어 보지 않는다.
    expect(await resolveLinkActor(first.token, cookieHeaders(first.cookie))).toEqual({
      ok: false,
      reason: 'closed',
    });
    expect(await client.fieldworkLinks.get({ surveyId })).toMatchObject({ link: null });

    const second = await client.fieldworkLinks.issue({ surveyId });
    expect(second.link.token).not.toBe(first.token);

    // 옛 행이 계보로 남는다 — 부분 UNIQUE 가 활성 하나만 강제한다.
    const rows = await db
      .select({ token: linksTable.token, closedAt: linksTable.closedAt })
      .from(linksTable)
      .where(eq(linksTable.surveyId, surveyId));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.closedAt === null)).toHaveLength(1);
  });

  it('링크가 없는 설문에서 종료·재설정·평문 조회는 NOT_FOUND 다', async () => {
    for (const call of [
      () => client.fieldworkLinks.close({ surveyId }),
      () => client.fieldworkLinks.resetPassword({ surveyId }),
      () => client.fieldworkLinks.revealPassword({ surveyId }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑤ 비밀번호 변경이 선 세션을 끊는다
  // ───────────────────────────────────────────────────────────────────────────

  it('비밀번호를 바꾸면 이미 들어와 있던 세션이 그 순간 끊긴다', async () => {
    const { token, cookie } = await issueAndSignIn();
    const headers = cookieHeaders(cookie);
    expect(await resolveLinkActor(token, headers)).toMatchObject({ ok: true });

    const reset = await client.fieldworkLinks.resetPassword({ surveyId, password: 'NewPass2026' });
    // 변경 전 쿠키로 다시 오면 거부다 — 판정은 시각의 대소가 아니라 표식 값의 일치다.
    expect(await resolveLinkActor(token, headers)).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
    // 표식이 실제로 움직였다는 것을 컬럼에서 확인한다(쿠키에 든 값과 달라졌다).
    expect(reset.link.passwordUpdatedAt.toISOString()).not.toBe(
      JSON.parse(Buffer.from(cookie.value.split('.')[0]!, 'base64url').toString('utf8'))
        .passwordUpdatedAt,
    );
  });

  it('주소는 바뀌지 않는다 — 비밀번호 변경은 토큰을 건드리지 않는다', async () => {
    const { token, password } = await issueAndSignIn();
    const reset = await client.fieldworkLinks.resetPassword({ surveyId, password: 'NewPass2026' });
    expect(reset.link.token).toBe(token);

    // 새 비밀번호로는 같은 주소에서 다시 들어간다. 옛 비밀번호는 더 이상 통하지 않는다.
    expect(await authenticateFieldworkLink(token, 'NewPass2026')).toMatchObject({ ok: true });
    expect(await authenticateFieldworkLink(token, password)).toEqual({
      ok: false,
      reason: 'denied',
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑥ 콘솔 축 — 사유의 대비와 파티션 고정 (티켓 06)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 링크 세션 하나를 들고 **scoped 표면 전수**를 두드린다.
   *
   * 목으로는 못 한다: `rowsFor` 는 WHERE 를 모르므로 어떤 설문 id 를 넣어도 같은 행을
   * 돌려주고, 그러면 자기 설문과 타 설문이 구별되지 않는다. 사유가 갈리지 않으면 링크
   * 하나가 「어느 조사가 존재하는가」를 확인하는 창구가 된다.
   */
  function linkClientFor(cookie: { name: string; value: string }) {
    return createRouterClient(router, {
      context: {
        db,
        user: null,
        headers: cookieHeaders(cookie),
        // 컨텍스트 조립은 `createContext` 가 하지만 여기서는 라우터를 직접 부르므로 같은
        // 재료를 손으로 싣는다 — 서명 검증은 이미 접속 성공이 끝낸 일이다.
        linkSessions: readFieldworkLinkSessions(cookieHeaders(cookie)),
      } satisfies ORPCContext,
    });
  }

  function callerFor(client: unknown, path: string): (input: unknown) => Promise<unknown> {
    const fn = path
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], client);
    if (typeof fn !== 'function') throw new Error(`호출할 수 없는 경로: ${path}`);
    return fn as (input: unknown) => Promise<unknown>;
  }

  describe('자기 설문 — 권한 밖은 FORBIDDEN', () => {
    it.each(LINK_BLOCKED_SCOPED_PATHS)('%s 는 권한 부족으로 막힌다', async (path) => {
      // 존재는 이미 안다(링크를 들고 있으니까) — 여기서 NOT_FOUND 가 나오면 외주 콘솔이
      // 자기 조사를 「없는 것」으로 보게 된다.
      const { cookie } = await issueAndSignIn();
      await expect(
        callerFor(linkClientFor(cookie), path)({ surveyId, ...SCOPED_INPUTS[path] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('타 설문 — NOT_FOUND', () => {
    it.each([...LINK_OPEN_SCOPED_PATHS, ...LINK_BLOCKED_SCOPED_PATHS])(
      '%s 는 존재를 알리지 않는다',
      async (path) => {
        // 이 링크에게 이웃 설문은 **존재하지 않는 것**이다 — 자기 설문의 FORBIDDEN 과 갈려야
        // 링크 하나가 「어느 조사가 있는가」를 확인하는 창구가 되지 않는다. UNAUTHORIZED 가
        // 아닌 것도 의도다: 그 코드는 「세션이 끊겼다」는 뜻이라 멀쩡한 비밀번호를 다시 넣게
        // 만든다. 자기 설문에서 열리는 여섯까지 함께 묻는 이유는 열린 문이 타 설문으로 새면
        // 명단이 통째로 넘어가기 때문이다.
        const { cookie } = await issueAndSignIn();
        await expect(
          callerFor(linkClientFor(cookie), path)({
            surveyId: neighbourSurveyId,
            ...SCOPED_INPUTS[path],
          }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      },
    );

    it('링크 세션이 아예 없으면 UNAUTHORIZED 다 — 「없는 설문」과 갈린다', async () => {
      // 접속하지 않은 사람에게는 사유를 말할 것이 없다. 이 갈림이 없으면 위의 NOT_FOUND 가
      // 「세션은 있는데 그 설문이 아니다」를 뜻한다는 사실이 증명되지 않는다.
      const anonymous = createRouterClient(router, {
        context: { db, user: null, headers: new Headers() } satisfies ORPCContext,
      });
      await expect(
        callerFor(anonymous, 'contacts.attrValues.list')({ surveyId, attrsKey: 'k' }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('이웃 설문의 링크 쿠키를 함께 들고 와도 이 설문은 이웃 것으로 열리지 않는다', async () => {
      // 두 조사를 병행하는 브라우저가 실제 상황이다. 쿠키를 고르는 기준이 payload 의
      // 설문 id 이므로, 이웃 쿠키는 이웃 설문에만 선다.
      const mine = await issueAndSignIn();
      const neighbour = await issueAndSignIn(neighbourSurveyId);
      const both = createRouterClient(router, {
        context: {
          db,
          user: null,
          headers: cookieHeaders(mine.cookie, neighbour.cookie),
          linkSessions: readFieldworkLinkSessions(cookieHeaders(mine.cookie, neighbour.cookie)),
        } satisfies ORPCContext,
      });
      // 두 설문 모두에서 자기 쿠키로 관문을 지난다 — 스킴에 없는 열이라 서비스가
      // FORBIDDEN_COLUMN 으로 거부하는데, 그것은 관문이 아니라 **지나간 뒤**의 거부다.
      for (const target of [surveyId, neighbourSurveyId]) {
        await expect(
          callerFor(both, 'contacts.attrValues.list')({ surveyId: target, attrsKey: '없는열' }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN_COLUMN' });
      }
    });
  });

  describe('파티션 — 테스트 모드를 켜도 링크는 실데이터를 본다', () => {
    it('읽기·쓰기 모두 real 이다 — 비대칭 금지', async () => {
      await db
        .update(surveysTable)
        .set({ testModeEnabled: true })
        .where(eq(surveysTable.id, surveyId));
      const { cookie } = await issueAndSignIn();
      const session = await resolveLinkActor(
        (await db
          .select({ token: linksTable.token })
          .from(linksTable)
          .where(eq(linksTable.surveyId, surveyId))
          .limit(1))[0]!.token,
        cookieHeaders(cookie),
      );
      if (!session.ok) throw new Error('세션이 서지 않았다');

      // 담당 연구원(내부 계정)은 test 를 보는 설문이다 — 그 상태에서 링크만 real 이어야
      // 「밖에서 전화 돌리는 사람이 실제 연락처를 본다」가 성립한다.
      expect(await loadOperationsDataScope(surveyId, session.actor)).toBe('real');
      expect(
        await loadOperationsDataScope(surveyId, {
          id: OWNER_ID,
          isSuperadmin: false,
          userType: 'internal',
        }),
      ).toBe('test');
    });

    it('링크가 보는 목록이 실 파티션 행이다', async () => {
      await db
        .update(surveysTable)
        .set({ testModeEnabled: true })
        .where(eq(surveysTable.id, surveyId));
      // 같은 설문에 실/테스트 대상을 하나씩 심는다 — 파티션을 잘못 고르면 표가 반대 행을 센다.
      await db.insert(contactTargetsTable).values([
        {
          surveyId,
          resid: 1,
          isTest: false,
          inviteCode: `fwreal${surveyId.slice(0, 8)}`,
          attrs: { 이름: '실데이터' },
        },
        {
          surveyId,
          resid: 1,
          isTest: true,
          inviteCode: `fwtest${surveyId.slice(0, 8)}`,
          attrs: { 이름: '테스트' },
        },
      ]);
      const { cookie } = await issueAndSignIn();
      const [row] = await db
        .select({ token: linksTable.token })
        .from(linksTable)
        .where(eq(linksTable.surveyId, surveyId))
        .limit(1);
      const session = await resolveLinkActor(row!.token, cookieHeaders(cookie));
      if (!session.ok) throw new Error('세션이 서지 않았다');

      const page = await loadContactsListPage({
        surveyId,
        scope: await loadOperationsDataScope(surveyId, session.actor),
        canViewMail: false,
        searchParams: {},
      });
      expect(page.total).toBe(1);
      expect(page.rows[0]?.attrs['이름']).toBe('실데이터');
    });
  });

  describe('메일 축 — 링크 목록에는 열도 필터도 정렬도 없다', () => {
    it('「수신 상황」 열이 스킴·필터 후보에서 함께 빠지고 정렬도 폴백된다', async () => {
      await db.insert(contactTargetsTable).values({
        surveyId,
        resid: 1,
        isTest: false,
        inviteCode: `fwmail${surveyId.slice(0, 8)}`,
        attrs: { 회사명: '가나다' },
      });
      // 연구원이 「수신 상황」 열을 켜 둔 상태를 만든다 — 그 설정이 외주 목록까지 따라가면
      // 초대 메일의 전달·열람·반송이 협력사에 그대로 보인다.
      await db
        .update(surveysTable)
        .set({
          contactColumns: {
            version: 1,
            headerRow: 1,
            columns: [
              { key: 'resid', source: 'system.resid', label: '시스템ID', order: 0 },
              { key: '회사명', source: 'attrs.회사명', label: '회사명', order: 1 },
              { key: 'email', source: 'system.email_count', label: '수신 상황', order: 2 },
            ],
          },
        })
        .where(eq(surveysTable.id, surveyId));

      const args = { surveyId, scope: 'real' as const, searchParams: { sort: 'mailStatus' } };
      const researcher = await loadContactsListPage({ ...args, canViewMail: true });
      const outsourced = await loadContactsListPage({ ...args, canViewMail: false });

      // 연구원 쪽은 종전 그대로여야 한다 — 이 단언이 없으면 「둘 다 빠졌다」도 통과한다.
      expect(researcher.scheme?.columns.map((c) => c.source)).toContain('system.email_count');
      expect(researcher.sort).toBe('mailStatus');

      expect(outsourced.scheme?.columns.map((c) => c.source)).not.toContain('system.email_count');
      expect(outsourced.columnCandidates.map((c) => c.source)).not.toContain('system.email_count');
      // 보이지 않는 축으로 줄을 세울 수 없다 — 열만 숨기면 URL 의 sort 가 그대로 산다.
      expect(outsourced.sort).toBe('resid');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⑦ 귀속 — 링크가 넣은 회차는 링크 칸에 남는다 (티켓 08, 0127)
  // ───────────────────────────────────────────────────────────────────────────

  describe('결과코드 회차의 귀속', () => {
    /** 같은 설문에 조사 대상 하나 — 회차를 붙일 자리다. */
    async function seedTarget(): Promise<string> {
      const id = crypto.randomUUID();
      await db.insert(contactTargetsTable).values({
        id,
        surveyId,
        resid: 1,
        isTest: false,
        inviteCode: `fwatt${id.slice(0, 10)}`,
        attrs: { 회사명: '가나다' },
      });
      return id;
    }

    it('링크가 넣으면 링크 칸이 차고 계정 칸은 빈다', async () => {
      const { cookie, linkId } = await issueAndSignIn();
      const contactTargetId = await seedTarget();

      await callerFor(linkClientFor(cookie), 'contacts.attempts.add')({
        surveyId,
        contactTargetId,
        resultCode: '1.조사완료',
        note: '부재 — 오후 재통화',
      });

      const [row] = await db
        .select({
          createdBy: attemptsTable.createdBy,
          fieldworkLinkId: attemptsTable.fieldworkLinkId,
          resultCode: attemptsTable.resultCode,
        })
        .from(attemptsTable)
        .where(eq(attemptsTable.contactTargetId, contactTargetId));

      // 계정 칸에 무엇이든 실리면 남의 이름으로 기록이 남는다 — 그 자리는 비어야 한다.
      expect(row).toMatchObject({
        createdBy: null,
        fieldworkLinkId: linkId,
        resultCode: '1.조사완료',
      });
    });

    it('연구원이 넣으면 계정 칸이 차고 링크 칸은 빈다 — 짝 단언', async () => {
      // 이 단언이 없으면 「둘 다 항상 null」도 위 테스트를 통과한다.
      const contactTargetId = await seedTarget();
      await client.fieldworkLinks.issue({ surveyId });

      await createRouterClient(
        { contacts: { attempts } },
        {
          context: {
            db,
            user: {
              id: OWNER_ID,
              email: `fw-link-${OWNER_ID}@example.com`,
              name: '링크발급자',
              status: 'active',
              isSuperadmin: false,
              userType: 'internal',
            },
            headers: new Headers(),
          } satisfies ORPCContext,
        },
      ).contacts.attempts.add({ surveyId, contactTargetId, resultCode: '2.거절' });

      const [row] = await db
        .select({
          createdBy: attemptsTable.createdBy,
          fieldworkLinkId: attemptsTable.fieldworkLinkId,
        })
        .from(attemptsTable)
        .where(eq(attemptsTable.contactTargetId, contactTargetId));
      expect(row).toEqual({ createdBy: OWNER_ID, fieldworkLinkId: null });
    });

    it('두 칸을 함께 채운 INSERT 는 DB 가 거부한다 — 배타 CHECK', async () => {
      // 서비스 가드가 아니라 제약이어야 하는 이유: 둘 다 찬 행이 생기면 「누가 넣었는가」에
      // 답이 둘이 되고, 그때는 이미 어느 쪽이 참인지 알 방법이 없다.
      const { linkId } = await issueAndSignIn();
      const contactTargetId = await seedTarget();
      // drizzle 은 원문을 `cause` 로 감싼다 — 제약 **이름**을 확인해야 「아무 이유로나
      // 실패했다」와 갈린다(컬럼 오타로 실패해도 그냥 throw 는 통과한다).
      const violation = await db
        .insert(attemptsTable)
        .values({
          contactTargetId,
          attemptNo: 1,
          resultCode: '1.조사완료',
          createdBy: OWNER_ID,
          fieldworkLinkId: linkId,
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(violation).not.toBeNull();
      const cause = (violation as { cause?: { constraint_name?: string } }).cause;
      expect(cause?.constraint_name).toBe('contact_attempts_author_exclusive_check');
    });

    it('귀속이 남은 링크도 종료된다 — 종료가 행 삭제가 아니기 때문', async () => {
      // FK 가 RESTRICT 라 하드 삭제였다면 여기서 막힌다. 0126 이 종료를 closedAt 전환으로
      // 둔 결정이 이 자리를 내다본 것이고, 되돌리면 「종료했더니 지난 기록자가 끊긴다」가 된다.
      const { cookie, linkId } = await issueAndSignIn();
      const contactTargetId = await seedTarget();
      await callerFor(linkClientFor(cookie), 'contacts.attempts.add')({
        surveyId,
        contactTargetId,
        resultCode: '1.조사완료',
      });

      await client.fieldworkLinks.close({ surveyId });

      const [link] = await db
        .select({ closedAt: linksTable.closedAt })
        .from(linksTable)
        .where(eq(linksTable.id, linkId));
      expect(link?.closedAt).not.toBeNull();
      // 회차는 그대로 남아 있고 귀속도 끊기지 않았다.
      const [attempt] = await db
        .select({ fieldworkLinkId: attemptsTable.fieldworkLinkId })
        .from(attemptsTable)
        .where(eq(attemptsTable.contactTargetId, contactTargetId));
      expect(attempt?.fieldworkLinkId).toBe(linkId);
    });
  });
});
