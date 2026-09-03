import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  questionGroups,
  questions,
  surveyDocumentAnchors,
  surveyDocuments,
  surveys,
} from '@/db/schema';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

/**
 * 순수 함수로는 잡을 수 없는 DB 계약만 잰다.
 *
 * 03 에서 다형 참조(종류 + id, FK 없음)를 기각한 **유일한 이유**가 이 계약이다 —
 * FK 가 없으면 앱이 정리를 빠뜨렸을 때 고아 앵커가 남고, 그것이 다음 발행 때
 * 스냅샷에 실려 응답 화면에 유령 사각형으로 그려진다. 그러니 실제로 잰다.
 */
run('앵커 DB 계약 — FK CASCADE 와 CHECK', () => {
  const surveyIds: string[] = [];

  afterAll(async () => {
    for (const id of surveyIds) {
      await db.delete(surveys).where(eq(surveys.id, id));
    }
  });

  async function seed() {
    const surveyId = randomUUID();
    await db.insert(surveys).values({ id: surveyId, title: '앵커 계약 테스트' });
    surveyIds.push(surveyId);

    const [document] = await db
      .insert(surveyDocuments)
      .values({
        surveyId,
        fileKey: `survey/document/${randomUUID()}.pdf`,
        filename: '조사표.pdf',
        pageCount: 20,
      })
      .returning();

    const [group] = await db
      .insert(questionGroups)
      .values({ surveyId, name: 'A. 일반', order: 0 })
      .returning();

    const [question] = await db
      .insert(questions)
      .values({ surveyId, groupId: group!.id, type: 'radio', title: 'A1 업종', order: 0 })
      .returning();

    return { surveyId, documentId: document!.id, groupId: group!.id, questionId: question!.id };
  }

  const rect = { page: 3, x: 0.1, y: 0.2, w: 0.4, h: 0.1 };

  it('질문을 지우면 그 앵커가 함께 사라진다', async () => {
    const { surveyId, documentId, questionId } = await seed();
    const [anchor] = await db
      .insert(surveyDocumentAnchors)
      .values({ surveyId, documentId, questionId, ...rect })
      .returning();

    await db.delete(questions).where(eq(questions.id, questionId));

    const left = await db
      .select()
      .from(surveyDocumentAnchors)
      .where(eq(surveyDocumentAnchors.id, anchor!.id));
    expect(left).toHaveLength(0);
  });

  it('그룹을 지우면 그 앵커가 함께 사라진다', async () => {
    const { surveyId, documentId, groupId } = await seed();
    const [anchor] = await db
      .insert(surveyDocumentAnchors)
      .values({ surveyId, documentId, groupId, ...rect })
      .returning();

    await db.delete(questionGroups).where(eq(questionGroups.id, groupId));

    const left = await db
      .select()
      .from(surveyDocumentAnchors)
      .where(eq(surveyDocumentAnchors.id, anchor!.id));
    expect(left).toHaveLength(0);
  });

  it('조사표를 지우면 그 앵커가 함께 사라진다', async () => {
    const { surveyId, documentId, groupId } = await seed();
    const [anchor] = await db
      .insert(surveyDocumentAnchors)
      .values({ surveyId, documentId, groupId, ...rect })
      .returning();

    await db.delete(surveyDocuments).where(eq(surveyDocuments.id, documentId));

    const left = await db
      .select()
      .from(surveyDocumentAnchors)
      .where(eq(surveyDocumentAnchors.id, anchor!.id));
    expect(left).toHaveLength(0);
  });

  it('두 FK 를 동시에 채우면 거부한다', async () => {
    const { surveyId, documentId, groupId, questionId } = await seed();
    await expect(
      db.insert(surveyDocumentAnchors).values({ surveyId, documentId, groupId, questionId, ...rect }),
    ).rejects.toThrow();
  });

  it('두 FK 를 모두 비우면 거부한다', async () => {
    const { surveyId, documentId } = await seed();
    await expect(
      db.insert(surveyDocumentAnchors).values({ surveyId, documentId, ...rect }),
    ).rejects.toThrow();
  });

  it('한 대상에 사각형 여럿이 붙는다 — 그룹이 여러 쪽에 걸치는 경우', async () => {
    const { surveyId, documentId, groupId } = await seed();
    await db.insert(surveyDocumentAnchors).values([
      { surveyId, documentId, groupId, page: 3, x: 0.1, y: 0.5, w: 0.8, h: 0.4, order: 0 },
      { surveyId, documentId, groupId, page: 4, x: 0.1, y: 0.0, w: 0.8, h: 0.3, order: 1 },
    ]);

    const rows = await db
      .select()
      .from(surveyDocumentAnchors)
      .where(eq(surveyDocumentAnchors.groupId, groupId));
    expect(rows.map((r) => r.page).sort()).toEqual([3, 4]);
  });

  it('쪽 밖·크기 0 좌표를 거부한다', async () => {
    const { surveyId, documentId, groupId } = await seed();
    await expect(
      db
        .insert(surveyDocumentAnchors)
        .values({ surveyId, documentId, groupId, page: 0, x: 0, y: 0, w: 0.5, h: 0.5 }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(surveyDocumentAnchors)
        .values({ surveyId, documentId, groupId, page: 1, x: 0, y: 0, w: 0, h: 0.5 }),
    ).rejects.toThrow();
  });
});
