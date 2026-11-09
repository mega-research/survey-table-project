import { and, asc, eq, ne, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { personalSurveyTagLinks, personalSurveyTags, surveyFavorites, users } from '@/db/schema';
import { isForeignKeyViolation, isUniqueViolation } from '@/lib/pg-error';

import {
  type CreatePersonalTagInput,
  type CreatePersonalTagOutput,
  type DeletePersonalTagInput,
  type DeletePersonalTagOutput,
  type MinePersonalTagsOutput,
  PERSONAL_TAG_FILTER_HALF_LIFE_DAYS,
  PersonalMarkTargetGoneError,
  PersonalTagLimitError,
  PersonalTagNameTakenError,
  PersonalTagNotFoundError,
  type RecordTagFilterInput,
  type RecordTagFilterOutput,
  type SetFavoriteInput,
  type SetFavoriteOutput,
  type SetSurveyListWhoseInput,
  type SetSurveyListWhoseOutput,
  type SetTagLinkInput,
  type SetTagLinkOutput,
  type UpdatePersonalTagInput,
  type UpdatePersonalTagOutput,
  isPersonalTagLimitReached,
  pickPersonalTagColor,
} from '../domain/personal-marks';

/**
 * 즐겨찾기 맞추기 — 결과 상태 지정 (설문 즐겨찾기·태그 티켓 06).
 *
 * 볼 수 있는 설문인지는 procedure 의 `survey.view` 관문이 끝냈다 — 편집 권한이 없어도 볼 수
 * 있으면 켤 수 있다. 여기는 요청자 본인의 행만 만진다(`userId` 는 세션에서 온다).
 *
 * - 켜기: `ON CONFLICT DO NOTHING` 삽입 — 이미 켜져 있으면 아무 일도 없다.
 * - 끄기: 삭제 — 켠 적이 없어도 오류가 아니다.
 *
 * 그래서 연타·재시도·탭 두 개가 마지막으로 도착한 상태로 수렴한다. 관문을 지난 뒤 설문이 사라져
 * 켜기가 외래 키에서 깨지면 NOT_FOUND(`PersonalMarkTargetGoneError`)다. `updatedAt` 은 건드리지 않는다
 * — 설문 내용이 아니라 내 정리라 「최신 수정순」이 별 하나에 흔들리면 안 된다.
 */
export async function setFavorite(
  userId: string,
  input: SetFavoriteInput,
): Promise<SetFavoriteOutput> {
  if (input.on) {
    try {
      await db
        .insert(surveyFavorites)
        .values({ userId, surveyId: input.surveyId })
        .onConflictDoNothing();
    } catch (err) {
      // 관문과 쓰기 사이에 설문이 하드 삭제됐다 — 태그 연결과 같은 NOT_FOUND 로 접는다.
      if (isForeignKeyViolation(err)) throw new PersonalMarkTargetGoneError();
      throw err;
    }
  } else {
    await db
      .delete(surveyFavorites)
      .where(and(eq(surveyFavorites.userId, userId), eq(surveyFavorites.surveyId, input.surveyId)));
  }
  return { surveyId: input.surveyId, on: input.on };
}

/**
 * 내 태그인가 — 아니면(남의 것·없는 것) 같은 NOT_FOUND. 태그 소유는 언제나 요청자 id 를 조건에
 * 건다 — 남의 태그 id 로 존재를 확인할 수 없게.
 */
async function assertOwnTag(userId: string, tagId: string): Promise<void> {
  const [row] = await db
    .select({ id: personalSurveyTags.id })
    .from(personalSurveyTags)
    .where(and(eq(personalSurveyTags.id, tagId), eq(personalSurveyTags.userId, userId)))
    .limit(1);
  if (!row) throw new PersonalTagNotFoundError();
}

/**
 * 태그 연결 맞추기 — 즐겨찾기와 같은 결과 상태 지정 (티켓 07).
 *
 * 설문을 볼 수 있는지는 procedure 의 `survey.view` 관문이, 태그가 내 것인지는 여기가 본다.
 * 확인과 쓰기 사이에 태그나 설문이 지워지면 켜기는 FK 에서 깨진다 — 그것도 NOT_FOUND 로 접는다.
 */
export async function setTagLink(
  userId: string,
  input: SetTagLinkInput,
): Promise<SetTagLinkOutput> {
  await assertOwnTag(userId, input.tagId);
  if (input.on) {
    try {
      await db
        .insert(personalSurveyTagLinks)
        .values({ tagId: input.tagId, surveyId: input.surveyId })
        .onConflictDoNothing();
    } catch (err) {
      if (isForeignKeyViolation(err)) throw new PersonalMarkTargetGoneError();
      throw err;
    }
  } else {
    await db
      .delete(personalSurveyTagLinks)
      .where(
        and(
          eq(personalSurveyTagLinks.tagId, input.tagId),
          eq(personalSurveyTagLinks.surveyId, input.surveyId),
        ),
      );
  }
  return { surveyId: input.surveyId, tagId: input.tagId, on: input.on };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 사용자 단위 태그 잠금 — 트랜잭션이 끝나면 풀린다. 300개 한도를 「세기 → 넣기」 사이에 끼어들
 * 수 없게 한다. 태그를 만드는 경로는 `createTag` 하나뿐이라 이 잠금이 한도의 유일한 근거다.
 * 이름 고치기(`updateTag`)도 같은 잠금을 잡는다 — 만들기와 고치기가 같은 이름으로 엇갈려
 * 「같은 이름이 없다」를 함께 보는 창이 없다(유일 인덱스는 최후 방어선으로 남는다).
 */
export async function lockPersonalTags(tx: Pick<Tx, 'execute'>, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('personal-tags-' || ${userId}))`);
}

/** 내 태그 한 줄을 붙은 설문 수와 함께 — 볼 수 없게 된 설문도 센다(내가 붙인 수). */
const linkCountSql =
  sql<number>`(select count(*) from ${personalSurveyTagLinks} where ${personalSurveyTagLinks.tagId} = ${personalSurveyTags.id})`.mapWith(
    Number,
  );

/**
 * 검색에 건 점수를 지금 시각으로 감쇠한 값 — `점수 × 0.5^(지난 일수 / 반감기)`. 걸 때(`recordTagFilter`)도
 * 같은 식으로 줄인 뒤 1 을 더하므로, 점수는 「최근 얼마나 자주 걸었나」를 하나의 수로 담는다.
 */
const HALF_LIFE_SECONDS = PERSONAL_TAG_FILTER_HALF_LIFE_DAYS * 86_400;
const decayedFilterScoreSql = sql`(${personalSurveyTags.filterScore} * power(0.5, extract(epoch from (now() - coalesce(${personalSurveyTags.lastFilteredAt}, now()))) / ${HALF_LIFE_SECONDS}))`;

const tagItemColumns = {
  id: personalSurveyTags.id,
  name: personalSurveyTags.name,
  color: personalSurveyTags.color,
  linkCount: linkCountSql,
  recentFilterScore: sql<number>`${decayedFilterScoreSql}`.mapWith(Number),
};

/** 내 태그 전부 — 요청자 행만. 순서는 화면이 정한다(많이 쓴 순·가나다순). */
export async function listMyTags(userId: string): Promise<MinePersonalTagsOutput> {
  const tags = await db
    .select(tagItemColumns)
    .from(personalSurveyTags)
    .where(eq(personalSurveyTags.userId, userId))
    .orderBy(asc(personalSurveyTags.createdAt), asc(personalSurveyTags.id));
  return { tags };
}

/**
 * 태그를 검색에 걸었다 (0157) — 점수를 지금 시각으로 감쇠한 뒤 1 을 더하고 시각을 남긴다. 한 문장이라
 * 연타·탭 두 개가 겹쳐도 더하기가 빠지지 않는다. 남의 태그·없는 태그는 바뀐 행이 없어 NOT_FOUND 다.
 * `updatedAt` 은 건드리지 않는다 — 이름·색을 고친 시각이지 쓴 시각이 아니다.
 */
export async function recordTagFilter(
  userId: string,
  input: RecordTagFilterInput,
): Promise<RecordTagFilterOutput> {
  const rows = await db
    .update(personalSurveyTags)
    .set({
      filterScore: sql`${decayedFilterScoreSql} + 1`,
      lastFilteredAt: sql`now()`,
    })
    .where(and(eq(personalSurveyTags.id, input.tagId), eq(personalSurveyTags.userId, userId)))
    .returning({ id: personalSurveyTags.id });
  if (rows.length === 0) throw new PersonalTagNotFoundError();
  return { tagId: input.tagId };
}

/**
 * 태그 만들기(+ 붙이기) — 한 트랜잭션 (티켓 07).
 *
 * 1. 사용자 잠금 — 같은 사람의 만들기끼리 줄 세운다.
 * 2. 같은 이름(`lower(btrim(name))`)이 있으면 새로 만들지 않고 그 태그를 쓴다 — 한도와 무관하다.
 * 3. 없으면 300개를 세고, 넘으면 거부한다. 색은 내 태그에서 가장 적게 쓴 색.
 * 4. 붙일 설문이 있으면 같은 트랜잭션에서 붙인다 — 붙이기가 실패하면(설문이 사라짐 등) 태그도
 *    남지 않는다.
 *
 * 설문을 볼 수 있는지는 procedure 의 `survey.view` 관문이 트랜잭션 앞에서 끝냈다.
 */
export async function createTag(
  userId: string,
  input: CreatePersonalTagInput,
): Promise<CreatePersonalTagOutput> {
  return db.transaction(async (tx) => {
    await lockPersonalTags(tx, userId);

    const mine = await tx
      .select({ id: personalSurveyTags.id, color: personalSurveyTags.color })
      .from(personalSurveyTags)
      .where(eq(personalSurveyTags.userId, userId));
    const [existing] = await tx
      .select({ id: personalSurveyTags.id })
      .from(personalSurveyTags)
      .where(
        and(
          eq(personalSurveyTags.userId, userId),
          sql`lower(btrim(${personalSurveyTags.name})) = lower(btrim(${input.name}))`,
        ),
      )
      .limit(1);

    let tagId: string;
    if (existing) {
      tagId = existing.id;
    } else {
      if (isPersonalTagLimitReached(mine.length)) throw new PersonalTagLimitError();
      const [inserted] = await tx
        .insert(personalSurveyTags)
        .values({ userId, name: input.name, color: pickPersonalTagColor(mine.map((t) => t.color)) })
        .returning({ id: personalSurveyTags.id });
      if (!inserted) throw new Error('personal_survey_tags insert returned no row');
      tagId = inserted.id;
    }

    if (input.attachToSurveyId) {
      try {
        await tx
          .insert(personalSurveyTagLinks)
          .values({ tagId, surveyId: input.attachToSurveyId })
          .onConflictDoNothing();
      } catch (err) {
        // 던지면 트랜잭션이 되돌아가 방금 만든 태그도 남지 않는다.
        if (isForeignKeyViolation(err)) throw new PersonalMarkTargetGoneError();
        throw err;
      }
    }

    const [tag] = await tx
      .select(tagItemColumns)
      .from(personalSurveyTags)
      .where(eq(personalSurveyTags.id, tagId));
    if (!tag) throw new Error('personal_survey_tags row vanished inside its transaction');
    return { tag, created: !existing };
  });
}

/**
 * 태그 고치기 — 이름·색 중 보낸 것만 (티켓 08).
 *
 * 사용자 잠금 아래에서 1) 내 태그인지 2) 다른 내 태그와 이름이 겹치는지(`lower(btrim(name))`,
 * 자기 자신은 뺀다 — 대소문자만 바꾸는 것은 충돌이 아니다)를 보고 쓴다. 겹치면 만들기와 달리
 * 기존 태그로 접지 않고 CONFLICT 다 — 두 태그를 합치는 것은 사용자가 고른 일이 아니다.
 * 같은 태그를 연달아 고치면 잠금 순서대로 쓰여 나중 값이 남는다.
 */
export async function updateTag(
  userId: string,
  input: UpdatePersonalTagInput,
): Promise<UpdatePersonalTagOutput> {
  try {
    return await db.transaction(async (tx) => {
      await lockPersonalTags(tx, userId);

      const own = and(
        eq(personalSurveyTags.id, input.tagId),
        eq(personalSurveyTags.userId, userId),
      );
      const [current] = await tx
        .select({ id: personalSurveyTags.id })
        .from(personalSurveyTags)
        .where(own)
        .limit(1);
      if (!current) throw new PersonalTagNotFoundError();

      if (input.name !== undefined) {
        const [clash] = await tx
          .select({ id: personalSurveyTags.id })
          .from(personalSurveyTags)
          .where(
            and(
              eq(personalSurveyTags.userId, userId),
              ne(personalSurveyTags.id, input.tagId),
              sql`lower(btrim(${personalSurveyTags.name})) = lower(btrim(${input.name}))`,
            ),
          )
          .limit(1);
        if (clash) throw new PersonalTagNameTakenError();
      }

      // 명시 필드 대입 — 요청 객체를 펼치지 않는다.
      const patch: Partial<typeof personalSurveyTags.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.color !== undefined) patch.color = input.color;
      await tx.update(personalSurveyTags).set(patch).where(own);

      const [tag] = await tx.select(tagItemColumns).from(personalSurveyTags).where(own);
      if (!tag) throw new Error('personal_survey_tags row vanished inside its transaction');
      return tag;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new PersonalTagNameTakenError();
    throw err;
  }
}

/**
 * 태그 지우기 (티켓 08) — 내 행만 지운다. 붙어 있던 연결은 FK `ON DELETE CASCADE` 가 함께
 * 지운다. 남의 태그·이미 없는 태그는 같은 NOT_FOUND 다(다른 탭에서 먼저 지운 경우도 이것).
 */
export async function deleteTag(
  userId: string,
  input: DeletePersonalTagInput,
): Promise<DeletePersonalTagOutput> {
  const deleted = await db
    .delete(personalSurveyTags)
    .where(and(eq(personalSurveyTags.id, input.tagId), eq(personalSurveyTags.userId, userId)))
    .returning({ id: personalSurveyTags.id });
  if (deleted.length === 0) throw new PersonalTagNotFoundError();
  return { tagId: input.tagId };
}

/**
 * 설문 목록의 보는 자리 저장 (0158) — 요청자 본인 행만 쓴다(입력에 사용자 칸이 없다). 같은 값을 두 번
 * 보내도 결과가 같다. users 는 auth 소관이지만 이 칸은 목록 화면의 개인 설정이라 여기서 쓴다.
 */
export async function setSurveyListWhose(
  userId: string,
  input: SetSurveyListWhoseInput,
): Promise<SetSurveyListWhoseOutput> {
  await db.update(users).set({ surveyListWhose: input.whose }).where(eq(users.id, userId));
  return { whose: input.whose };
}
