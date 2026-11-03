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
import { contactAttempts, contactTargetEditLogs, contactTargets, surveys } from '@/db/schema';
import {
  addAttempt,
  deleteAttempt,
  updateAttempt,
} from '@/server/contacts/services/contact-attempts';

// 요청 밖이라 쿠키가 없다 — 콘솔은 실데이터 파티션을 본다(server/data-scope).
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

// created_by 는 auth.users 를 가리키는 uuid 열이다 — 실제 로그인 사용자처럼 auth.users 에 있는 id 를 쓴다.
const editorId = randomUUID();
const editor = { id: editorId, email: 'caller@local' };

run('대상 정보 수정 현황 — 컨택 결과 회차 (real DB)', () => {
  const surveyIds: string[] = [];

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO auth.users (id) VALUES (${editorId})`);
  });

  afterAll(async () => {
    for (const id of surveyIds) await db.delete(surveys).where(eq(surveys.id, id));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${editorId}`);
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
      editor,
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

  it('기록자 id 가 auth.users 의 uuid 가 아니면 id 는 비우고 이메일만 채운다 — 추가는 실패하지 않는다', async () => {
    const { surveyId, targetId } = await seed();

    await addAttempt({ contactTargetId: targetId, surveyId, resultCode: '13. 독려' }, false, {
      id: 'test-admin',
      email: 'plain@local',
    });
    await addAttempt({ contactTargetId: targetId, surveyId, resultCode: '3.비수신' }, false, {
      id: randomUUID(),
      email: 'gone@local',
    });

    const rows = await attemptsOf(targetId);
    expect(rows.map((r) => [r.attemptNo, r.createdBy, r.createdByEmail])).toEqual([
      [1, null, 'plain@local'],
      [2, null, 'gone@local'],
    ]);
  });

  it('회차를 지우면 지운 회차의 결과코드·비고·기록자·기록 시각이 이전 값으로 남는다', async () => {
    const { surveyId, targetId } = await seed();
    const added = await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려', note: '금일중' },
      false,
      editor,
    );
    const [attempt] = await attemptsOf(targetId);

    await deleteAttempt({ surveyId, contactTargetId: targetId, id: added.id }, false, {
      id: 'deleter',
      email: 'deleter@local',
    });

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
      editor,
    );
    await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려', note: '금일중' },
      false,
      editor,
    );
    const second = (await attemptsOf(targetId))[1]!;

    await updateAttempt(
      { id: second.id, contactTargetId: targetId, surveyId, resultCode: '3.비수신' },
      false,
      { id: 'fixer', email: 'fixer@local' },
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

  it('결과코드·비고가 그대로인 수정은 기록을 남기지 않는다 — 비고 없음과 빈 비고는 같다', async () => {
    const { surveyId, targetId } = await seed();
    const added = await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려' },
      false,
      editor,
    );

    await updateAttempt(
      { id: added.id, contactTargetId: targetId, surveyId, resultCode: '13. 독려', note: '' },
      false,
      editor,
    );

    expect(await logsOf(targetId)).toEqual([]);
  });

  it('기록을 남기지 못하면 회차 삭제도 되지 않는다', async () => {
    const { surveyId, targetId } = await seed();
    const added = await addAttempt(
      { contactTargetId: targetId, surveyId, resultCode: '13. 독려' },
      false,
      editor,
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
        deleteAttempt({ surveyId, contactTargetId: targetId, id: added.id }, false, editor),
      ).rejects.toThrow();
    } finally {
      await db.execute(
        sql.raw(`DROP TRIGGER ${fn} ON contact_target_edit_logs; DROP FUNCTION ${fn}();`),
      );
    }

    expect(await attemptsOf(targetId)).toHaveLength(1);
  });
});
