/**
 * 카드 제목(surveys.list_title) 실 DB 왕복 — procedure → service → PostgreSQL.
 *
 * 카드 제목은 설문 관리·설문 분석 목록의 카드에만 쓰는 이름이다(CONTEXT.md 「카드 제목」). 여기서 고정하는 것:
 *   - 정한 값이 목록 조회에 실린다. 안 정한 설문은 null(목록이 설문 제목을 보인다)
 *   - 빈 값 · 설문 제목과 같은 값은 지우는 것이다
 *   - 설문 내용이 아니라 `updatedAt` 을 올리지 않는다
 *   - 빌더의 설문 설정 저장(`surveys.update`)이 카드 제목을 지우지 않는다
 *   - 복제본은 카드 제목에도 「(복사본)」이 붙는다
 *
 * 실행 조건: DATABASE_URL 이 로컬일 때만(일반 pnpm test 에서는 건너뛴다).
 */
import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { surveys as surveysTable } from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import { surveys } from '@/server/survey-builder/procedures/surveys';
import { getSurveyListWithCounts } from '@/server/survey-builder/services/survey-read';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

function authedContext(): ORPCContext {
  return {
    db,
    supabase: {} as never,
    user: { id: 'admin-list-title', email: 'admin@example.com' },
  };
}

describe.skipIf(!isLocalDb)('카드 제목 (real local DB)', () => {
  const client = createRouterClient({ surveys }, { context: authedContext() });
  const createdSurveyIds: string[] = [];

  afterAll(async () => {
    for (const id of createdSurveyIds) {
      await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
  });

  async function createSurvey(title: string) {
    const row = await client.surveys.create({ title });
    createdSurveyIds.push(row.id);
    return row;
  }

  async function listItem(id: string) {
    const list = await getSurveyListWithCounts();
    return list.find((item) => item.id === id);
  }

  it('카드 제목을 정하지 않은 설문은 목록에 null 로 실린다 — 목록이 설문 제목을 보인다', async () => {
    const survey = await createSurvey('카드제목-기본');

    const item = await listItem(survey.id);
    expect(item?.title).toBe('카드제목-기본');
    expect(item?.listTitle).toBeNull();
  });

  it('정한 카드 제목이 목록에 실리고 설문 제목은 그대로다', async () => {
    const survey = await createSurvey('한국언론진흥재단 이용자 만족도 설문조사 (계약체결)');

    const result = await client.surveys.setListTitle({
      surveyId: survey.id,
      listTitle: '  1-1.  경영지원팀 — 계약체결 ',
    });

    expect(result.listTitle).toBe('1-1. 경영지원팀 — 계약체결');
    const item = await listItem(survey.id);
    expect(item?.listTitle).toBe('1-1. 경영지원팀 — 계약체결');
    expect(item?.title).toBe('한국언론진흥재단 이용자 만족도 설문조사 (계약체결)');
  });

  it('카드 제목은 설문 내용이 아니다 — updatedAt 을 올리지 않는다', async () => {
    const survey = await createSurvey('카드제목-수정일');
    const [before] = await db
      .select({ updatedAt: surveysTable.updatedAt })
      .from(surveysTable)
      .where(eq(surveysTable.id, survey.id));

    await client.surveys.setListTitle({ surveyId: survey.id, listTitle: '이름표' });

    const [after] = await db
      .select({ updatedAt: surveysTable.updatedAt, listTitle: surveysTable.listTitle })
      .from(surveysTable)
      .where(eq(surveysTable.id, survey.id));
    expect(after?.listTitle).toBe('이름표');
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });

  it('빈 값 · 공백 · null · 설문 제목과 같은 값은 카드 제목을 지운다', async () => {
    const survey = await createSurvey('카드제목-지우기');

    for (const cleared of ['', '   ', null, '카드제목-지우기', ' 카드제목-지우기 ']) {
      await client.surveys.setListTitle({ surveyId: survey.id, listTitle: '이름표' });
      const result = await client.surveys.setListTitle({ surveyId: survey.id, listTitle: cleared });
      expect(result.listTitle, JSON.stringify(cleared)).toBeNull();
      expect((await listItem(survey.id))?.listTitle, JSON.stringify(cleared)).toBeNull();
    }
  });

  it('같은 값으로 다시 정해도 결과가 같다', async () => {
    const survey = await createSurvey('카드제목-멱등');

    const first = await client.surveys.setListTitle({ surveyId: survey.id, listTitle: '이름표' });
    const second = await client.surveys.setListTitle({ surveyId: survey.id, listTitle: '이름표' });

    expect(second).toEqual(first);
    expect((await listItem(survey.id))?.listTitle).toBe('이름표');
  });

  it('설문 설정 저장은 카드 제목을 지우지 않는다', async () => {
    const survey = await createSurvey('카드제목-설정저장');
    await client.surveys.setListTitle({ surveyId: survey.id, listTitle: '이름표' });

    await client.surveys.update({
      surveyId: survey.id,
      data: { title: '카드제목-설정저장(고침)', description: '설명' },
    });

    const item = await listItem(survey.id);
    expect(item?.title).toBe('카드제목-설정저장(고침)');
    expect(item?.listTitle).toBe('이름표');
  });

  it('복제본은 카드 제목에도 「(복사본)」이 붙고, 카드 제목이 없던 설문의 복제본은 없는 채다', async () => {
    const named = await createSurvey('카드제목-복제-원본');
    await client.surveys.setListTitle({ surveyId: named.id, listTitle: '이름표' });
    const plain = await createSurvey('카드제목-복제-없음');

    const namedCopy = await client.surveys.duplicate({ surveyId: named.id });
    const plainCopy = await client.surveys.duplicate({ surveyId: plain.id });
    if (namedCopy) createdSurveyIds.push(namedCopy.id);
    if (plainCopy) createdSurveyIds.push(plainCopy.id);

    expect(namedCopy?.title).toBe('카드제목-복제-원본 (복사본)');
    expect(namedCopy?.listTitle).toBe('이름표 (복사본)');
    expect(plainCopy?.listTitle).toBeNull();
  });

  it('없는 설문이면 NOT_FOUND 이고, 200자를 넘는 값은 거부한다', async () => {
    await expect(
      client.surveys.setListTitle({
        surveyId: '00000000-0000-4000-8000-000000000000',
        listTitle: '이름표',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const survey = await createSurvey('카드제목-상한');
    await expect(
      client.surveys.setListTitle({ surveyId: survey.id, listTitle: '가'.repeat(201) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await listItem(survey.id))?.listTitle).toBeNull();
  });
});
