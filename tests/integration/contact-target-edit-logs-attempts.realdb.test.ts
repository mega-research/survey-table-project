/**
 * 대상 정보 수정 현황 — 컨택 결과 회차 실 DB 왕복 (.scratch/contact-edit-history/PRD.md 「기록 대상」·「판정」).
 *
 * 회차 추가는 기록자를 회차 행에 채우고 현황에는 남기지 않는다. 회차 수정·삭제는 대상 잠금 아래에서
 * 바꾸기 전 행을 읽어 같은 트랜잭션에 한 줄을 남긴다. 바깥 결과(회차 행·기록 표)로만 단언한다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { contactAttempts, contactTargetEditLogs, contactTargets, surveys, users } from '@/db/schema';
import {
  addAttempt,
  deleteAttempt,
  updateAttempt,
} from '@/server/contacts/services/contact-attempts';
import { getContactDetailById } from '@/server/read-models/contacts';
import { FIELDWORK_SHARE_ALL } from '@/server/fieldwork-share';

// 요청 밖이라 쿠키가 없다 — 콘솔은 실데이터 파티션을 본다(server/data-scope).
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

// created_by 는 public.users 를 가리키는 FK 다(0121, RESTRICT) — 실제 로그인 계정처럼 users 에 있는 id 를 쓴다.
// 귀속(author)은 계정 칸, 기록자 글자(editor)는 그 계정의 이메일이다.
const editorId = randomUUID();
const editor = { id: editorId, email: 'caller@local' };
const author = { accountUserId: editorId, fieldworkLinkId: null };

run('대상 정보 수정 현황 — 컨택 결과 회차 (real DB)', () => {
  const surveyIds: string[] = [];

  beforeAll(async () => {
    const now = new Date();
    await db.insert(users).values({
      id: editorId,
      name: '기록자',
      email: `caller-${editorId}@local`,
      emailVerified: true,
      status: 'active',
      userType: 'internal',
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    // 회차가 계정을 RESTRICT 로 잡으므로 설문(→ 대상 → 회차 cascade)을 먼저 지운다.
    for (const id of surveyIds) await db.delete(surveys).where(eq(surveys.id, id));
    await db.delete(users).where(eq(users.id, editorId));
  });

  async function seed() {
    const surveyId = randomUUID();
    surveyIds.push(surveyId);
    await db.insert(surveys).values({ id: surveyId, title: '회차 기록' });
    const targetId = randomUUID();
    await db.insert(contactTargets).values({
      id: targetId,
      surveyId,
      resid: 1,
      isTest: false,
      attrs: {},
      inviteCode: randomUUID(),
    });
    return { surveyId, targetId };
  }

  async function attemptsOf(targetId: string) {
    return db
      .select()
      .from(contactAttempts)
      .where(eq(contactAttempts.contactTargetId, targetId))
      .orderBy(sql`${contactAttempts.attemptNo} asc`);
  }

  async function logsOf(targetId: string) {
    return db
      .select()
      .from(contactTargetEditLogs)
      .where(eq(contactTargetEditLogs.contactTargetId, targetId))
      .orderBy(sql`${contactTargetEditLogs.createdAt} asc`);
  }

  it('회차를 추가하면 기록자 id·이메일이 회차에 채워지고 현황에는 남지 않는다', async () => {
    const { surveyId, targetId } = await seed();

    await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려', note: '금일중' },
      false,
      author,
      editor,
      FIELDWORK_SHARE_ALL,
    );

    const rows = await attemptsOf(targetId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attemptNo: 1,
      resultCode: '13. 독려',
      note: '금일중',
      createdBy: editorId,
      createdByEmail: 'caller@local',
    });
    expect(await logsOf(targetId)).toEqual([]);
  });

  it('회차를 지우면 지운 회차의 결과코드·비고·기록자·기록 시각이 이전 값으로 남는다', async () => {
    const { surveyId, targetId } = await seed();
    const added = await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려', note: '금일중' },
      false,
      author,
      editor,
      FIELDWORK_SHARE_ALL,
    );
    const [attempt] = await attemptsOf(targetId);

    await deleteAttempt({ surveyId, contactTargetId: targetId, id: added.id }, false, {
      id: 'deleter',
      email: 'deleter@local',
    }, FIELDWORK_SHARE_ALL);

    expect(await attemptsOf(targetId)).toEqual([]);
    const logs = await logsOf(targetId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      surveyId,
      action: 'attempt_delete',
      editedBy: 'deleter',
      editorEmail: 'deleter@local',
      changes: [
        {
          kind: 'attempt',
          attemptNo: 1,
          before: {
            resultCode: '13. 독려',
            note: '금일중',
            createdByEmail: 'caller@local',
            createdAt: attempt!.createdAt.toISOString(),
          },
          after: null,
        },
      ],
    });
  });

  it('회차를 고치면 고치기 전 값과 고친 값이 함께 남고 회차 행은 고친 값이 된다', async () => {
    const { surveyId, targetId } = await seed();
    await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려' },
      false,
      author,
      editor,
      FIELDWORK_SHARE_ALL,
    );
    await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려', note: '금일중' },
      false,
      author,
      editor,
      FIELDWORK_SHARE_ALL,
    );
    const second = (await attemptsOf(targetId))[1]!;

    await updateAttempt(
      { id: second.id, contactTargetId: targetId, surveyId, resultCode: '3.비수신' },
      false,
      { id: 'fixer', email: 'fixer@local' },
      FIELDWORK_SHARE_ALL,
    );

    const after = (await attemptsOf(targetId))[1]!;
    expect(after).toMatchObject({ resultCode: '3.비수신', note: null });
    const logs = await logsOf(targetId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'attempt_edit',
      editedBy: 'fixer',
      editorEmail: 'fixer@local',
      changes: [
        {
          kind: 'attempt',
          attemptNo: 2,
          before: {
            resultCode: '13. 독려',
            note: '금일중',
            createdByEmail: 'caller@local',
            createdAt: second.createdAt.toISOString(),
          },
          after: { resultCode: '3.비수신', note: null },
        },
      ],
    });
  });

  it('1,000자를 넘는 비고는 기록에 1,000자만 잘림 표식과 함께 남고 회차 행은 전부 남는다', async () => {
    const { surveyId, targetId } = await seed();
    const longBefore = '가'.repeat(1200);
    const longAfter = '나'.repeat(1500);
    const added = await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려', note: longBefore },
      false,
      author,
      editor,
      FIELDWORK_SHARE_ALL,
    );

    await updateAttempt(
      {
        id: added.id,
        contactTargetId: targetId,
        surveyId,
        resultCode: '13. 독려',
        note: longAfter,
      },
      false,
      editor,
      FIELDWORK_SHARE_ALL,
    );
    await deleteAttempt({ surveyId, contactTargetId: targetId, id: added.id }, false, editor, FIELDWORK_SHARE_ALL);

    const logs = await logsOf(targetId);
    expect(logs.map((l) => l.changes)).toEqual([
      [
        expect.objectContaining({
          before: expect.objectContaining({ note: '가'.repeat(1000) }),
          after: { resultCode: '13. 독려', note: '나'.repeat(1000) },
          beforeTruncated: true,
          afterTruncated: true,
        }),
      ],
      [
        expect.objectContaining({
          before: expect.objectContaining({ note: '나'.repeat(1000) }),
          after: null,
          beforeTruncated: true,
        }),
      ],
    ]);
  });

  it('결과코드·비고가 그대로인 수정은 기록을 남기지 않는다 — 비고 없음과 빈 비고는 같다', async () => {
    const { surveyId, targetId } = await seed();
    const added = await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려' },
      false,
      author,
      editor,
      FIELDWORK_SHARE_ALL,
    );

    await updateAttempt(
      { id: added.id, contactTargetId: targetId, surveyId, resultCode: '13. 독려', note: '' },
      false,
      editor,
      FIELDWORK_SHARE_ALL,
    );

    expect(await logsOf(targetId)).toEqual([]);
  });

  it('기록을 남기지 못하면 회차 삭제도 되지 않는다', async () => {
    const { surveyId, targetId } = await seed();
    const added = await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려' },
      false,
      author,
      editor,
      FIELDWORK_SHARE_ALL,
    );
    // 이 대상의 기록 INSERT 만 실패시키는 트리거 — 테스트가 끝나면 지운다.
    const fn = `ceh_fail_attempt_log_${targetId.replace(/-/g, '')}`;
    await db.execute(
      sql.raw(`
        CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'edit log insert blocked'; END $$;
        CREATE TRIGGER ${fn} BEFORE INSERT ON contact_target_edit_logs
          FOR EACH ROW WHEN (NEW.contact_target_id = '${targetId}') EXECUTE FUNCTION ${fn}();
      `),
    );
    try {
      await expect(
        deleteAttempt({ surveyId, contactTargetId: targetId, id: added.id }, false, editor, FIELDWORK_SHARE_ALL),
      ).rejects.toThrow();
    } finally {
      await db.execute(
        sql.raw(`DROP TRIGGER ${fn} ON contact_target_edit_logs; DROP FUNCTION ${fn}();`),
      );
    }

    expect(await attemptsOf(targetId)).toHaveLength(1);
  });

  it('상세 화면이 읽는 회차 목록에 기록자 이메일이 실리고, 기록자 기능 전 회차는 비어 있다', async () => {
    const { surveyId, targetId } = await seed();
    // 기록자 기능 전에 적힌 회차 — 기록자 칸이 둘 다 NULL 이다.
    await db.insert(contactAttempts).values({
      contactTargetId: targetId,
      attemptNo: 1,
      resultCode: '13. 독려',
    });
    await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '3.비수신' },
      false,
      author,
      editor,
      FIELDWORK_SHARE_ALL,
    );

    const detail = await getContactDetailById(targetId, surveyId, 'real', { kind: 'all' });
    expect(detail?.attempts.map((a) => [a.attemptNo, a.createdByEmail])).toEqual([
      [2, 'caller@local'],
      [1, null],
    ]);
  });
});
