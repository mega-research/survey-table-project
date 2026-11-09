/**
 * 개인 표시 — 즐겨찾기 쓰기 (설문 즐겨찾기·태그 티켓 06) — 실 로컬 DB.
 *
 * 즐겨찾기는 결과 상태 지정이다: 켜기는 충돌 무시 삽입, 끄기는 삭제. 연타·재시도·탭 두 개가 같은
 * 결과로 수렴하는 것은 PK 와 `ON CONFLICT` 가 지키므로 목으로는 볼 수 없어 실제 행으로 본다.
 * 설문 하드 삭제의 cascade 와 soft delete 의 보존도 FK 정의가 지키는 성질이라 같은 이유다.
 *
 * 관문(survey.view)은 procedure 첫 줄이 진다 — 볼 수 없는 설문 id 의 거부는 교차 팀 IDOR 인벤토리
 * (`cross-team-idor-rpc.test.ts`)가 본다. 목록 쪽(즐겨찾기만 조건·내 별 여부·숫자)은
 * `survey-list-page.realdb.test.ts`.
 */
import { createRouterClient } from '@orpc/server';
import { internalActorContext } from '@tests/helpers/rpc-context';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  personalSurveyTagLinks as personalSurveyTagLinksTable,
  personalSurveyTags as personalSurveyTagsTable,
  surveyFavorites as surveyFavoritesTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import {
  CreatePersonalTagInput,
  PersonalMarkTargetGoneError,
  PersonalTagLimitError,
  PersonalTagNameTakenError,
  PersonalTagNotFoundError,
  UpdatePersonalTagInput,
} from '@/server/workspace/domain/personal-marks';
import { personalMarks } from '@/server/workspace/procedures/personal-marks';
import {
  createTag,
  deleteTag,
  listMyTags,
  lockPersonalTags,
  recordTagFilter,
  setFavorite,
  setTagLink,
  updateTag,
} from '@/server/workspace/services/personal-marks';
import {
  PERSONAL_TAG_LIMIT,
  type PersonalTagColor,
  personalTagColorValues,
} from '@/shared/contracts/workspace';

import { backendPid, waitForLockWaitersBehind } from '../helpers/lock-waiters';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const ME = crypto.randomUUID();
const COLLEAGUE = crypto.randomUUID();
const TEAM = crypto.randomUUID();
const S = {
  idempotent: crypto.randomUUID(),
  offTwice: crypto.randomUUID(),
  shared: crypto.randomUUID(),
  hardDeleted: crypto.randomUUID(),
  softDeleted: crypto.randomUUID(),
};
const surveyIds = Object.values(S);

async function favoriteRows(surveyId: string, userId?: string) {
  return db
    .select({ userId: surveyFavoritesTable.userId })
    .from(surveyFavoritesTable)
    .where(
      userId
        ? and(eq(surveyFavoritesTable.surveyId, surveyId), eq(surveyFavoritesTable.userId, userId))
        : eq(surveyFavoritesTable.surveyId, surveyId),
    );
}

describe.skipIf(!isLocalDb)('개인 표시 — 즐겨찾기 쓰기 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values(
      [ME, COLLEAGUE].map((id) => ({
        id,
        name: `fav-${id.slice(0, 6)}`,
        email: `personal-marks-${id}@example.com`,
        emailVerified: true,
        status: 'active' as const,
        isSuperadmin: false,
        userType: 'internal' as const,
      })),
    );
    await db.insert(teamsTable).values({ id: TEAM, name: `fav-${TEAM.slice(0, 8)}` });
    await db.insert(surveysTable).values(
      surveyIds.map((id) => ({
        id,
        title: `fav ${id.slice(0, 6)}`,
        teamId: TEAM,
        ownerUserId: ME,
        createdBy: ME,
        visibility: 'team' as const,
        assignmentStatus: 'assigned' as const,
      })),
    );
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    await db.delete(surveyFavoritesTable).where(inArray(surveyFavoritesTable.surveyId, surveyIds));
    await db.delete(surveysTable).where(inArray(surveysTable.id, surveyIds));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM));
    await db.delete(usersTable).where(inArray(usersTable.id, [ME, COLLEAGUE]));
  });

  it('켜기를 두 번 보내도 행은 하나다 — 결과는 둘 다 켜짐', async () => {
    const first = await setFavorite(ME, { surveyId: S.idempotent, on: true });
    const second = await setFavorite(ME, { surveyId: S.idempotent, on: true });

    expect(first).toEqual({ surveyId: S.idempotent, on: true });
    expect(second).toEqual({ surveyId: S.idempotent, on: true });
    expect(await favoriteRows(S.idempotent)).toHaveLength(1);
  });

  it('끄기를 두 번 보내도 오류가 없고 행이 없다 — 켠 적 없는 설문을 꺼도 같다', async () => {
    await setFavorite(ME, { surveyId: S.offTwice, on: true });

    await expect(setFavorite(ME, { surveyId: S.offTwice, on: false })).resolves.toEqual({
      surveyId: S.offTwice,
      on: false,
    });
    await expect(setFavorite(ME, { surveyId: S.offTwice, on: false })).resolves.toEqual({
      surveyId: S.offTwice,
      on: false,
    });
    expect(await favoriteRows(S.offTwice)).toEqual([]);
  });

  it('내 별을 꺼도 동료의 별은 남는다 — 별은 사람마다 따로다', async () => {
    await setFavorite(ME, { surveyId: S.shared, on: true });
    await setFavorite(COLLEAGUE, { surveyId: S.shared, on: true });

    await setFavorite(ME, { surveyId: S.shared, on: false });

    expect(await favoriteRows(S.shared)).toEqual([{ userId: COLLEAGUE }]);
  });

  it('관문과 쓰기 사이에 설문이 사라져 켜기가 외래 키에서 깨지면 NOT_FOUND 사유다 — 500 이 아니다', async () => {
    const gone = crypto.randomUUID();
    await expect(setFavorite(ME, { surveyId: gone, on: true })).rejects.toBeInstanceOf(
      PersonalMarkTargetGoneError,
    );
    expect(await favoriteRows(gone)).toEqual([]);
  });

  it('설문을 하드 삭제하면 별도 사라진다', async () => {
    await setFavorite(ME, { surveyId: S.hardDeleted, on: true });
    await setFavorite(COLLEAGUE, { surveyId: S.hardDeleted, on: true });

    await db.delete(surveysTable).where(eq(surveysTable.id, S.hardDeleted));

    expect(await favoriteRows(S.hardDeleted)).toEqual([]);
  });

  it('설문을 soft delete 해도 별은 남는다 — 복구하면 돌아온다', async () => {
    await setFavorite(ME, { surveyId: S.softDeleted, on: true });

    await db
      .update(surveysTable)
      .set({ deletedAt: new Date() })
      .where(eq(surveysTable.id, S.softDeleted));

    expect(await favoriteRows(S.softDeleted, ME)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 내 태그 (티켓 07) — 연결 맞추기 · 만들기(+붙이기) · 한도 경합 · 소유
// ─────────────────────────────────────────────────────────────────────────────

const T_ME = crypto.randomUUID();
const T_OTHER = crypto.randomUUID();
const T_FOREIGN_OWNER = crypto.randomUUID();
const T_COLOR = crypto.randomUUID();
const T_TEAM = crypto.randomUUID();
const T_FOREIGN_TEAM = crypto.randomUUID();
const TS = {
  link: crypto.randomUUID(),
  attach: crypto.randomUUID(),
  hardDeleted: crypto.randomUUID(),
  softDeleted: crypto.randomUUID(),
  /** 다른 팀 설문 — T_ME 는 볼 수 없다. */
  foreign: crypto.randomUUID(),
};
const tagSurveyIds = Object.values(TS);

async function tagRowsOf(userId: string) {
  return db
    .select({ id: personalSurveyTagsTable.id, name: personalSurveyTagsTable.name })
    .from(personalSurveyTagsTable)
    .where(eq(personalSurveyTagsTable.userId, userId));
}

async function linkRows(surveyId: string) {
  return db
    .select({ tagId: personalSurveyTagLinksTable.tagId })
    .from(personalSurveyTagLinksTable)
    .where(eq(personalSurveyTagLinksTable.surveyId, surveyId));
}

/** 태그 행을 바로 심는다 — 만들기 경로를 거치지 않는 준비용. */
async function seedTag(userId: string, name: string, color: PersonalTagColor = 'blue') {
  const [row] = await db
    .insert(personalSurveyTagsTable)
    .values({ userId, name, color })
    .returning({ id: personalSurveyTagsTable.id });
  return row!.id;
}

describe.skipIf(!isLocalDb)('개인 표시 — 내 태그 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values(
      [T_ME, T_OTHER, T_FOREIGN_OWNER, T_COLOR].map((id) => ({
        id,
        name: `tag-${id.slice(0, 6)}`,
        email: `personal-tags-${id}@example.com`,
        emailVerified: true,
        status: 'active' as const,
        isSuperadmin: false,
        userType: 'internal' as const,
      })),
    );
    await db.insert(teamsTable).values([
      { id: T_TEAM, name: `tag-${T_TEAM.slice(0, 8)}` },
      { id: T_FOREIGN_TEAM, name: `tag-${T_FOREIGN_TEAM.slice(0, 8)}` },
    ]);
    await db.insert(teamMembersTable).values([
      { teamId: T_TEAM, userId: T_ME, role: 'member' as const },
      { teamId: T_FOREIGN_TEAM, userId: T_FOREIGN_OWNER, role: 'member' as const },
    ]);
    await db.insert(surveysTable).values(
      tagSurveyIds.map((id) => {
        const foreign = id === TS.foreign;
        return {
          id,
          title: `tag ${id.slice(0, 6)}`,
          teamId: foreign ? T_FOREIGN_TEAM : T_TEAM,
          ownerUserId: foreign ? T_FOREIGN_OWNER : T_ME,
          createdBy: foreign ? T_FOREIGN_OWNER : T_ME,
          visibility: 'team' as const,
          assignmentStatus: 'assigned' as const,
        };
      }),
    );
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    const users = [T_ME, T_OTHER, T_FOREIGN_OWNER, T_COLOR];
    // 태그·연결은 사람 → 태그 → 연결 cascade 로 함께 사라진다.
    await db.delete(personalSurveyTagsTable).where(inArray(personalSurveyTagsTable.userId, users));
    await db.delete(surveysTable).where(inArray(surveysTable.id, tagSurveyIds));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, users));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [T_TEAM, T_FOREIGN_TEAM]));
    await db.delete(usersTable).where(inArray(usersTable.id, users));
  });

  it('연결 켜기를 두 번 보내도 행은 하나다 — 끄기 두 번도 오류 없이 행이 없다', async () => {
    const tagId = await seedTag(T_ME, '연결 멱등');

    const first = await setTagLink(T_ME, { surveyId: TS.link, tagId, on: true });
    const second = await setTagLink(T_ME, { surveyId: TS.link, tagId, on: true });
    expect(first).toEqual({ surveyId: TS.link, tagId, on: true });
    expect(second).toEqual({ surveyId: TS.link, tagId, on: true });
    expect(await linkRows(TS.link)).toEqual([{ tagId }]);

    await setTagLink(T_ME, { surveyId: TS.link, tagId, on: false });
    await expect(setTagLink(T_ME, { surveyId: TS.link, tagId, on: false })).resolves.toEqual({
      surveyId: TS.link,
      tagId,
      on: false,
    });
    expect(await linkRows(TS.link)).toEqual([]);
  });

  it('검색에 걸 때마다 점수가 1 씩 오르고 내 목록에 보인다 — 남의 태그·없는 태그는 NOT_FOUND (0157)', async () => {
    const tagId = await seedTag(T_ME, '자주 거름');
    const othersTag = await seedTag(T_OTHER, '남이 거름');

    const before = (await listMyTags(T_ME)).tags.find((t) => t.id === tagId);
    expect(before?.recentFilterScore).toBe(0);

    await recordTagFilter(T_ME, { tagId });
    await recordTagFilter(T_ME, { tagId });
    const after = (await listMyTags(T_ME)).tags.find((t) => t.id === tagId);
    // 두 번 사이 감쇠는 밀리초 단위라 2 에 아주 가깝다.
    expect(after?.recentFilterScore).toBeGreaterThan(1.99);
    expect(after?.recentFilterScore).toBeLessThanOrEqual(2);

    await expect(recordTagFilter(T_ME, { tagId: othersTag })).rejects.toBeInstanceOf(
      PersonalTagNotFoundError,
    );
    await expect(recordTagFilter(T_ME, { tagId: crypto.randomUUID() })).rejects.toBeInstanceOf(
      PersonalTagNotFoundError,
    );
    const [others] = await db
      .select({ score: personalSurveyTagsTable.filterScore })
      .from(personalSurveyTagsTable)
      .where(eq(personalSurveyTagsTable.id, othersTag));
    expect(others?.score).toBe(0);
  });

  it('점수는 14일마다 절반이 된다 — 마지막으로 건 시각에서 감쇠한 뒤 1 을 더한다 (0157)', async () => {
    const tagId = await seedTag(T_ME, '오래전 거름');
    // 28일 전에 4점이었다 → 지금 1점, 한 번 더 걸면 2점.
    await db
      .update(personalSurveyTagsTable)
      .set({ filterScore: 4, lastFilteredAt: new Date(Date.now() - 28 * 86_400_000) })
      .where(eq(personalSurveyTagsTable.id, tagId));
    const decayed = (await listMyTags(T_ME)).tags.find((t) => t.id === tagId);
    expect(decayed?.recentFilterScore).toBeCloseTo(1, 3);

    await recordTagFilter(T_ME, { tagId });
    const bumped = (await listMyTags(T_ME)).tags.find((t) => t.id === tagId);
    expect(bumped?.recentFilterScore).toBeCloseTo(2, 3);
  });

  it('남의 태그 id 로 붙이기·떼기 → 없는 태그와 같은 NOT_FOUND, 행도 안 생긴다', async () => {
    const othersTag = await seedTag(T_OTHER, '남의 태그');

    await expect(
      setTagLink(T_ME, { surveyId: TS.link, tagId: othersTag, on: true }),
    ).rejects.toBeInstanceOf(PersonalTagNotFoundError);
    await expect(
      setTagLink(T_ME, { surveyId: TS.link, tagId: othersTag, on: false }),
    ).rejects.toBeInstanceOf(PersonalTagNotFoundError);
    await expect(
      setTagLink(T_ME, { surveyId: TS.link, tagId: crypto.randomUUID(), on: true }),
    ).rejects.toBeInstanceOf(PersonalTagNotFoundError);
    expect(await linkRows(TS.link)).toEqual([]);
  });

  it('만들기 + 붙이기 — 새 태그가 생기고 그 설문에 붙는다, 내 목록에 붙은 수와 함께 보인다', async () => {
    const result = await createTag(T_ME, { name: '실태조사', attachToSurveyId: TS.attach });

    expect(result.created).toBe(true);
    expect(result.tag).toMatchObject({ name: '실태조사', linkCount: 1 });
    expect(await linkRows(TS.attach)).toEqual([{ tagId: result.tag.id }]);

    const mine = await listMyTags(T_ME);
    expect(mine.tags).toContainEqual(result.tag);
    // 남의 태그는 내 목록에 없다.
    expect(mine.tags.map((t) => t.name)).not.toContain('남의 태그');
  });

  it('「A사」가 있을 때 「 a사 」 만들기 → 새로 만들지 않고 기존 태그를 돌려주며 붙인다', async () => {
    const existing = await seedTag(T_ME, 'A사');

    // 이름 정규화는 입력 경계(zod)가 한다 — procedure 가 넘기는 값 그대로 부른다.
    const result = await createTag(
      T_ME,
      CreatePersonalTagInput.parse({ name: ' a사 ', attachToSurveyId: TS.attach }),
    );

    expect(result).toMatchObject({ created: false, tag: { id: existing, name: 'A사' } });
    expect((await tagRowsOf(T_ME)).filter((t) => t.name.toLowerCase() === 'a사')).toHaveLength(1);
    expect(await linkRows(TS.attach)).toContainEqual({ tagId: existing });
  });

  it('새 태그 색은 내 태그에서 가장 적게 쓴 색(같으면 어휘 순서)이다 — 남의 태그 색은 세지 않는다', async () => {
    for (const [name, color] of [
      ['파랑1', 'blue'],
      ['빨강1', 'red'],
      ['빨강2', 'red'],
      ['초록1', 'green'],
    ] as const) {
      await seedTag(T_COLOR, name, color);
    }
    // 남의 태그가 보라를 잔뜩 써도 T_COLOR 의 배정과 무관하다.
    await seedTag(T_OTHER, '남의 보라1', 'purple');
    await seedTag(T_OTHER, '남의 보라2', 'purple');

    const first = await createTag(T_COLOR, { name: '새1', attachToSurveyId: null });
    expect(first.tag).toMatchObject({ color: 'purple', linkCount: 0 });

    for (const color of ['amber', 'teal', 'pink', 'gray'] as const) {
      await seedTag(T_COLOR, `채움-${color}`, color);
    }
    // 이제 빨강만 2개, 나머지 1개씩 — 동점 중 어휘 첫 색.
    const second = await createTag(T_COLOR, { name: '새2', attachToSurveyId: null });
    expect(second.tag.color).toBe('blue');
  });

  it('붙일 설문이 사라져 붙이기가 실패하면 태그도 안 생긴다 — 만들기와 붙이기는 한 트랜잭션', async () => {
    await expect(
      createTag(T_ME, { name: '고아 될 태그', attachToSurveyId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(PersonalMarkTargetGoneError);
    expect((await tagRowsOf(T_ME)).map((t) => t.name)).not.toContain('고아 될 태그');
  });

  it('RPC — 볼 수 없는 설문에 만들며 붙이기 → NOT_FOUND, 태그도 안 생긴다', async () => {
    const rpc = createRouterClient(
      { personalMarks },
      { context: internalActorContext({ id: T_ME }) },
    );

    await expect(
      rpc.personalMarks.createTag({ name: '남의 설문 태그', attachToSurveyId: TS.foreign }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await tagRowsOf(T_ME)).map((t) => t.name)).not.toContain('남의 설문 태그');
    expect(await linkRows(TS.foreign)).toEqual([]);
  });

  it('RPC — 남의 태그 id 로 붙이기 → NOT_FOUND, 내 목록에는 내 태그만', async () => {
    const othersTag = await seedTag(T_OTHER, '남의 RPC 태그');
    const rpc = createRouterClient(
      { personalMarks },
      { context: internalActorContext({ id: T_ME }) },
    );

    await expect(
      rpc.personalMarks.setTagLink({ surveyId: TS.link, tagId: othersTag, on: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const { tags } = await rpc.personalMarks.mine();
    expect(tags.map((t) => t.id)).not.toContain(othersTag);
    expect(tags.length).toBe((await tagRowsOf(T_ME)).length);
  });

  it('설문 하드 삭제 → 연결이 사라진다, soft delete → 남는다', async () => {
    const tagId = await seedTag(T_ME, '삭제 연쇄');
    await setTagLink(T_ME, { surveyId: TS.hardDeleted, tagId, on: true });
    await setTagLink(T_ME, { surveyId: TS.softDeleted, tagId, on: true });

    await db.delete(surveysTable).where(eq(surveysTable.id, TS.hardDeleted));
    await db
      .update(surveysTable)
      .set({ deletedAt: new Date() })
      .where(eq(surveysTable.id, TS.softDeleted));

    expect(await linkRows(TS.hardDeleted)).toEqual([]);
    expect(await linkRows(TS.softDeleted)).toEqual([{ tagId }]);
  });
});

describe.skipIf(!isLocalDb)('개인 표시 — 내 태그 300개 한도 경합 (real local DB)', () => {
  const USER = crypto.randomUUID();

  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values({
      id: USER,
      name: `cap-${USER.slice(0, 6)}`,
      email: `personal-tags-cap-${USER}@example.com`,
      emailVerified: true,
      status: 'active' as const,
      isSuperadmin: false,
      userType: 'internal' as const,
    });
    await db.insert(personalSurveyTagsTable).values(
      Array.from({ length: PERSONAL_TAG_LIMIT - 1 }, (_, i) => ({
        userId: USER,
        name: `키워드${i}`,
        color: personalTagColorValues[i % personalTagColorValues.length]!,
      })),
    );
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    await db.delete(usersTable).where(eq(usersTable.id, USER));
  });

  it('299개에서 만들기 둘을 동시에 → 300개, 하나는 한도 거부', async () => {
    // 같은 사용자 잠금을 먼저 쥐고, 두 만들기가 그 뒤에 줄 선 것을 확인한 뒤 놓는다 — 둘이 같은
    // 「299개」를 보고 둘 다 넣는 경합을 잠금이 실제로 막는지 본다.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holderReady!: (pid: number) => void;
    const ready = new Promise<number>((resolve) => (holderReady = resolve));
    const holder = db.transaction(async (tx) => {
      await lockPersonalTags(tx, USER);
      holderReady(await backendPid(tx));
      await released;
    });
    const holderPid = await ready;

    const attempts = [
      createTag(USER, { name: '동시1', attachToSurveyId: null }),
      createTag(USER, { name: '동시2', attachToSurveyId: null }),
    ];
    await waitForLockWaitersBehind(holderPid, 2, '두 만들기가 사용자 잠금 뒤에 줄 서지 않았습니다');
    release();
    await holder;

    const settled = await Promise.allSettled(attempts);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(PersonalTagLimitError);
    expect(await tagRowsOf(USER)).toHaveLength(PERSONAL_TAG_LIMIT);
  });

  it('한도에서도 이미 있는 이름은 기존 태그를 돌려준다 — 새로 만드는 것이 아니다', async () => {
    const result = await createTag(USER, { name: '키워드0', attachToSurveyId: null });
    expect(result.created).toBe(false);
    expect(await tagRowsOf(USER)).toHaveLength(PERSONAL_TAG_LIMIT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 내 태그 고치기·지우기 (티켓 08) — 이름 충돌 · 소유 · 연쇄 삭제 · 나중 값
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!isLocalDb)('개인 표시 — 내 태그 고치기·지우기 (real local DB)', () => {
  const ME_E = crypto.randomUUID();
  const OTHER_E = crypto.randomUUID();
  const TEAM_E = crypto.randomUUID();
  const SURVEYS_E = [crypto.randomUUID(), crypto.randomUUID()];

  async function tagRow(tagId: string) {
    const [row] = await db
      .select({
        name: personalSurveyTagsTable.name,
        color: personalSurveyTagsTable.color,
        updatedAt: personalSurveyTagsTable.updatedAt,
      })
      .from(personalSurveyTagsTable)
      .where(eq(personalSurveyTagsTable.id, tagId));
    return row;
  }

  beforeAll(async () => {
    if (!isLocalDb) return;
    await db.insert(usersTable).values(
      [ME_E, OTHER_E].map((id) => ({
        id,
        name: `edit-${id.slice(0, 6)}`,
        email: `personal-tags-edit-${id}@example.com`,
        emailVerified: true,
        status: 'active' as const,
        isSuperadmin: false,
        userType: 'internal' as const,
      })),
    );
    await db.insert(teamsTable).values({ id: TEAM_E, name: `edit-${TEAM_E.slice(0, 8)}` });
    await db.insert(teamMembersTable).values({ teamId: TEAM_E, userId: ME_E, role: 'member' });
    await db.insert(surveysTable).values(
      SURVEYS_E.map((id) => ({
        id,
        title: `edit ${id.slice(0, 6)}`,
        teamId: TEAM_E,
        ownerUserId: ME_E,
        createdBy: ME_E,
        visibility: 'team' as const,
        assignmentStatus: 'assigned' as const,
      })),
    );
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    const users = [ME_E, OTHER_E];
    await db.delete(personalSurveyTagsTable).where(inArray(personalSurveyTagsTable.userId, users));
    await db.delete(surveysTable).where(inArray(surveysTable.id, SURVEYS_E));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, users));
    await db.delete(teamsTable).where(eq(teamsTable.id, TEAM_E));
    await db.delete(usersTable).where(inArray(usersTable.id, users));
  });

  it('다른 내 태그와 같은 이름(공백·대소문자 무시)으로 고치기 → 이름 충돌, 이름은 그대로', async () => {
    await seedTag(ME_E, 'B기관');
    const target = await seedTag(ME_E, '바꿀 태그');

    await expect(
      updateTag(ME_E, UpdatePersonalTagInput.parse({ tagId: target, name: ' b기관 ' })),
    ).rejects.toBeInstanceOf(PersonalTagNameTakenError);
    expect((await tagRow(target))?.name).toBe('바꿀 태그');
  });

  it('남의 태그와 같은 이름은 충돌이 아니다 — 내 것만 본다', async () => {
    await seedTag(OTHER_E, '남의 이름');
    const target = await seedTag(ME_E, '내 이름');

    const result = await updateTag(ME_E, { tagId: target, name: '남의 이름' });
    expect(result).toMatchObject({ id: target, name: '남의 이름' });
  });

  it('자기 이름의 대소문자만 바꾸는 것은 충돌이 아니다', async () => {
    const target = await seedTag(ME_E, 'abc사');
    await expect(updateTag(ME_E, { tagId: target, name: 'ABC사' })).resolves.toMatchObject({
      name: 'ABC사',
    });
  });

  it('색만 고치면 이름은 그대로, 고친 시각이 움직인다 — 붙은 수와 함께 돌려준다', async () => {
    const target = await seedTag(ME_E, '색 바꿀 태그', 'blue');
    await setTagLink(ME_E, { surveyId: SURVEYS_E[0]!, tagId: target, on: true });
    const before = await tagRow(target);

    const result = await updateTag(ME_E, { tagId: target, color: 'teal' });

    expect(result).toEqual({
      id: target,
      name: '색 바꿀 태그',
      color: 'teal',
      linkCount: 1,
      recentFilterScore: 0,
    });
    const after = await tagRow(target);
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it('같은 태그를 두 번 고치면 나중 값이 남는다 — 동시에 보내도 잠금 뒤에 줄 선다', async () => {
    const target = await seedTag(ME_E, '두 번', 'blue');

    await updateTag(ME_E, { tagId: target, name: '첫째', color: 'red' });
    await updateTag(ME_E, { tagId: target, name: '둘째' });
    expect(await tagRow(target)).toMatchObject({ name: '둘째', color: 'red' });

    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holderReady!: (pid: number) => void;
    const ready = new Promise<number>((resolve) => (holderReady = resolve));
    const holder = db.transaction(async (tx) => {
      await lockPersonalTags(tx, ME_E);
      holderReady(await backendPid(tx));
      await released;
    });
    const holderPid = await ready;
    const first = updateTag(ME_E, { tagId: target, color: 'green' });
    await waitForLockWaitersBehind(holderPid, 1, '첫 고치기가 사용자 잠금 뒤에 줄 서지 않았습니다');
    const second = updateTag(ME_E, { tagId: target, color: 'purple' });
    await waitForLockWaitersBehind(
      holderPid,
      2,
      '둘째 고치기가 사용자 잠금 뒤에 줄 서지 않았습니다',
    );
    release();
    await holder;
    await Promise.all([first, second]);
    expect((await tagRow(target))?.color).toBe('purple');
  });

  it('남의 태그·없는 태그 고치기 → NOT_FOUND, 남의 태그는 그대로', async () => {
    const othersTag = await seedTag(OTHER_E, '남의 고칠 태그', 'blue');

    await expect(updateTag(ME_E, { tagId: othersTag, name: '가로챔' })).rejects.toBeInstanceOf(
      PersonalTagNotFoundError,
    );
    await expect(updateTag(ME_E, { tagId: othersTag, color: 'red' })).rejects.toBeInstanceOf(
      PersonalTagNotFoundError,
    );
    await expect(
      updateTag(ME_E, { tagId: crypto.randomUUID(), name: '없음' }),
    ).rejects.toBeInstanceOf(PersonalTagNotFoundError);
    expect(await tagRow(othersTag)).toMatchObject({ name: '남의 고칠 태그', color: 'blue' });
  });

  it('지우면 태그와 연결이 함께 사라진다 — 다른 태그의 연결은 남는다', async () => {
    const doomed = await seedTag(ME_E, '지울 태그');
    const kept = await seedTag(ME_E, '남길 태그');
    for (const surveyId of SURVEYS_E) {
      await setTagLink(ME_E, { surveyId, tagId: doomed, on: true });
      await setTagLink(ME_E, { surveyId, tagId: kept, on: true });
    }

    await expect(deleteTag(ME_E, { tagId: doomed })).resolves.toEqual({ tagId: doomed });

    expect(await tagRow(doomed)).toBeUndefined();
    const links = await db
      .select({ tagId: personalSurveyTagLinksTable.tagId })
      .from(personalSurveyTagLinksTable)
      .where(inArray(personalSurveyTagLinksTable.tagId, [doomed, kept]));
    expect(links.map((l) => l.tagId)).toEqual([kept, kept]);
    expect((await listMyTags(ME_E)).tags.map((t) => t.id)).not.toContain(doomed);
  });

  it('남의 태그·없는 태그 지우기 → NOT_FOUND, 남의 태그와 연결은 남는다', async () => {
    const othersTag = await seedTag(OTHER_E, '남의 지울 태그');
    await db
      .insert(personalSurveyTagLinksTable)
      .values({ tagId: othersTag, surveyId: SURVEYS_E[1]! });

    await expect(deleteTag(ME_E, { tagId: othersTag })).rejects.toBeInstanceOf(
      PersonalTagNotFoundError,
    );
    await expect(deleteTag(ME_E, { tagId: crypto.randomUUID() })).rejects.toBeInstanceOf(
      PersonalTagNotFoundError,
    );
    expect(await tagRow(othersTag)).toBeDefined();
    expect(await linkRows(SURVEYS_E[1]!)).toContainEqual({ tagId: othersTag });
  });

  it('RPC — 이름 충돌은 CONFLICT 「이미 같은 이름의 태그가 있습니다」, 남의 태그는 NOT_FOUND', async () => {
    await seedTag(ME_E, 'RPC 기존');
    const mineTag = await seedTag(ME_E, 'RPC 바꿀');
    const othersTag = await seedTag(OTHER_E, 'RPC 남의');
    const rpc = createRouterClient(
      { personalMarks },
      { context: internalActorContext({ id: ME_E }) },
    );

    await expect(
      rpc.personalMarks.updateTag({ tagId: mineTag, name: 'rpc 기존' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: '이미 같은 이름의 태그가 있습니다' });
    await expect(
      rpc.personalMarks.updateTag({ tagId: othersTag, color: 'red' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(rpc.personalMarks.deleteTag({ tagId: othersTag })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(rpc.personalMarks.deleteTag({ tagId: mineTag })).resolves.toEqual({
      tagId: mineTag,
    });
    expect(await tagRow(othersTag)).toBeDefined();
  });
});
