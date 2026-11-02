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
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveyFavorites as surveyFavoritesTable,
  surveys as surveysTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import { setFavorite } from '@/server/workspace/services/personal-marks';

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
