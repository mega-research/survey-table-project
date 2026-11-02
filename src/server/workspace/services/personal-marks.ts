import { and, asc, eq, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { personalSurveyTagLinks, personalSurveyTags, surveyFavorites } from '@/db/schema';
import { isForeignKeyViolation } from '@/lib/pg-error';

import {
  type CreatePersonalTagInput,
  type CreatePersonalTagOutput,
  type MinePersonalTagsOutput,
  PersonalTagLimitError,
  PersonalTagNotFoundError,
  type SetFavoriteInput,
  type SetFavoriteOutput,
  type SetTagLinkInput,
  type SetTagLinkOutput,
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
 * 그래서 연타·재시도·탭 두 개가 마지막으로 도착한 상태로 수렴한다. `updatedAt` 은 건드리지 않는다
 * — 설문 내용이 아니라 내 정리라 「최신 수정순」이 별 하나에 흔들리면 안 된다.
 */
export async function setFavorite(
  userId: string,
  input: SetFavoriteInput,
): Promise<SetFavoriteOutput> {
  if (input.on) {
    await db
      .insert(surveyFavorites)
      .values({ userId, surveyId: input.surveyId })
      .onConflictDoNothing();
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
 * 확인과 쓰기 사이에 태그가 지워지면 켜기는 FK 에서 깨진다 — 그것도 없는 태그와 같은 NOT_FOUND
 * 로 접는다.
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
      if (isForeignKeyViolation(err)) throw new PersonalTagNotFoundError();
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
 */
export async function lockPersonalTags(tx: Pick<Tx, 'execute'>, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('personal-tags-' || ${userId}))`);
}

/** 내 태그 한 줄을 붙은 설문 수와 함께 — 볼 수 없게 된 설문도 센다(내가 붙인 수). */
const linkCountSql = sql<number>`(select count(*) from ${personalSurveyTagLinks} where ${personalSurveyTagLinks.tagId} = ${personalSurveyTags.id})`.mapWith(
  Number,
);

const tagItemColumns = {
  id: personalSurveyTags.id,
  name: personalSurveyTags.name,
  color: personalSurveyTags.color,
  linkCount: linkCountSql,
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
      await tx
        .insert(personalSurveyTagLinks)
        .values({ tagId, surveyId: input.attachToSurveyId })
        .onConflictDoNothing();
    }

    const [tag] = await tx
      .select(tagItemColumns)
      .from(personalSurveyTags)
      .where(eq(personalSurveyTags.id, tagId));
    if (!tag) throw new Error('personal_survey_tags row vanished inside its transaction');
    return { tag, created: !existing };
  });
}
