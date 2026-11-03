/**
 * 대상 정보 수정 현황 — 실 DB 왕복 (.scratch/contact-edit-history/PRD.md).
 *
 * 조사 대상 상세 저장(updateContactTarget)이 같은 트랜잭션에서 contact_target_edit_logs 에 한 줄을
 * 남기는지, 그 줄을 읽기 로더가 스코프·게스트에 맞게 내는지를 바깥 결과로만 단언한다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { contactTargetEditLogs, contactTargets, surveys } from '@/db/schema';
import { updateContactTarget } from '@/server/contacts/services/contact-targets';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

import { backendPid, waitForLockWaitersBehind } from '../helpers/lock-waiters';

// 요청 밖이라 쿠키가 없다 — 콘솔은 실데이터 파티션을 본다(server/data-scope).
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: '사업자등록증기업명', label: '사업자등록증기업명', source: 'attrs.사업자등록증기업명', order: 1 },
    { key: '명단기업명', label: '명단기업명', source: 'attrs.명단기업명', order: 2, hidden: true },
    { key: '지역', label: '지역', source: 'attrs.지역', order: 3 },
  ],
};

const editor = { id: 'editor-1', email: 'editor@local' };

run('대상 정보 수정 현황 (real DB)', () => {
  const surveyIds: string[] = [];

  afterAll(async () => {
    for (const id of surveyIds) await db.delete(surveys).where(eq(surveys.id, id));
  });

  async function seed(attrs: Record<string, string>, opts: { isTest?: boolean } = {}) {
    const surveyId = randomUUID();
    surveyIds.push(surveyId);
    await db.insert(surveys).values({
      id: surveyId,
      title: '대상 정보 수정 현황',
      contactColumns: scheme,
      testContactColumns: scheme,
    });
    const targetId = randomUUID();
    await db.insert(contactTargets).values({
      id: targetId,
      surveyId,
      resid: 1,
      isTest: opts.isTest ?? false,
      attrs,
      inviteCode: randomUUID(),
    });
    return { surveyId, targetId };
  }

  async function logsOf(targetId: string) {
    return db
      .select()
      .from(contactTargetEditLogs)
      .where(eq(contactTargetEditLogs.contactTargetId, targetId))
      .orderBy(sql`${contactTargetEditLogs.createdAt} asc`);
  }

  it('attrs 두 칸을 바꾸면 한 줄에 변경 둘이 이전·새 값과 함께 남는다', async () => {
    const { surveyId, targetId } = await seed({ 사업자등록증기업명: '-', 명단기업명: '-', 지역: '서울' });

    await updateContactTarget(
      {
        id: targetId,
        surveyId,
        attrs: { 사업자등록증기업명: '아리오나트', 명단기업명: '아리오나트', 지역: '서울' },
      },
      false,
      editor,
    );

    const logs = await logsOf(targetId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      surveyId,
      action: 'info_edit',
      editedBy: 'editor-1',
      editorEmail: 'editor@local',
      changes: [
        { kind: 'attr', key: '사업자등록증기업명', label: '사업자등록증기업명', before: '-', after: '아리오나트' },
        { kind: 'attr', key: '명단기업명', label: '명단기업명', before: '-', after: '아리오나트' },
      ],
    });
  });

  it('바뀐 것 없는 저장은 기록을 남기지 않는다', async () => {
    const { surveyId, targetId } = await seed({ 지역: '서울' });
    await db.update(contactTargets).set({ memo: '메모' }).where(eq(contactTargets.id, targetId));

    await updateContactTarget(
      { id: targetId, surveyId, attrs: { 지역: '서울' }, memo: '메모', contactMethod: null },
      false,
      editor,
    );

    expect(await logsOf(targetId)).toEqual([]);
  });

  it('같은 대상을 동시에 저장한 두 건은 각자 저장 직전 값을 이전 값으로 남긴다', async () => {
    const { surveyId, targetId } = await seed({ 지역: '서울' });

    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markHeld!: (pid: number) => void;
    const held = new Promise<number>((resolve) => {
      markHeld = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM contact_targets WHERE id = ${targetId} FOR UPDATE`);
      markHeld(await backendPid(tx));
      await released;
    });
    const holderPid = await held;

    // 두 저장 모두 화면을 연 시점(서울)에서 출발했지만, 줄을 서서 차례로 쓴다.
    const saveBusan = updateContactTarget(
      { id: targetId, surveyId, attrs: { 지역: '부산' } },
      false,
      { id: 'a', email: 'a@local' },
    );
    await waitForLockWaitersBehind(holderPid, 1, '첫 저장이 대상 잠금 뒤에 줄 서지 않았다');
    const saveDaegu = updateContactTarget(
      { id: targetId, surveyId, attrs: { 지역: '대구' } },
      false,
      { id: 'b', email: 'b@local' },
    );
    await waitForLockWaitersBehind(holderPid, 2, '두 번째 저장이 줄 서지 않았다');
    release();
    await Promise.all([holder, saveBusan, saveDaegu]);

    const logs = await logsOf(targetId);
    expect(logs).toHaveLength(2);
    const [first, second] = logs.map((l) => l.changes[0]);
    // 먼저 쓴 쪽은 서울에서, 나중에 쓴 쪽은 먼저 쓴 값에서 바꿨다 — 화면을 연 시점 값(서울)이 아니다.
    expect(first).toMatchObject({ kind: 'attr', key: '지역', before: '서울' });
    expect(second).toMatchObject({
      kind: 'attr',
      key: '지역',
      before: (first as { after: string }).after,
    });
    const [row] = await db
      .select({ attrs: contactTargets.attrs })
      .from(contactTargets)
      .where(eq(contactTargets.id, targetId));
    expect(row?.attrs).toEqual({ 지역: (second as { after: string }).after });
  });

  it('기록을 남기지 못하면 저장도 되지 않는다', async () => {
    const { surveyId, targetId } = await seed({ 지역: '서울' });
    // 이 대상의 기록 INSERT 만 실패시키는 트리거 — 테스트가 끝나면 지운다.
    const fn = `ceh_fail_log_${targetId.replace(/-/g, '')}`;
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
        updateContactTarget(
          { id: targetId, surveyId, attrs: { 지역: '부산' }, memo: '새 메모' },
          false,
          editor,
        ),
      ).rejects.toThrow();
    } finally {
      await db.execute(
        sql.raw(`DROP TRIGGER ${fn} ON contact_target_edit_logs; DROP FUNCTION ${fn}();`),
      );
    }

    const [row] = await db
      .select({ attrs: contactTargets.attrs, memo: contactTargets.memo })
      .from(contactTargets)
      .where(eq(contactTargets.id, targetId));
    expect(row).toEqual({ attrs: { 지역: '서울' }, memo: null });
    expect(await logsOf(targetId)).toEqual([]);
  });
});
