/**
 * 대상 정보 수정 현황 — 컨택원 단건 변경 실 DB 왕복 (.scratch/contact-edit-history/PRD.md 「판정」).
 *
 * 조사 대상 상세의 컨택원 드롭다운(setTargetAssignment)이 같은 트랜잭션에서
 * contact_target_edit_logs 에 「앞 컨택원 → 뒤 컨택원」 한 줄을 그때 이름으로 남기는지,
 * 그 줄이 게스트 화면 로더에서 빠지는지를 바깥 결과로만 단언한다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { contactTargetEditLogs, contactTargets, surveys } from '@/db/schema';
import { applyAssignment } from '@/server/contacts/services/contact-assignment-apply';
import {
  createAssignment,
  removeAssignment,
  renameAssignment,
  setTargetAssignment,
} from '@/server/contacts/services/contact-assignments';
import { getContactTargetEditLogs } from '@/server/read-models/contact-target-edit-logs';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

import { backendPid, waitForLockWaitersBehind } from '../helpers/lock-waiters';

// 요청 밖이라 쿠키가 없다 — 콘솔은 실데이터 파티션을 본다(server/data-scope).
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

const editor = { id: 'editor-1', email: 'editor@local' };

// 교체 적용 조건이 시스템ID 열을 읽는다.
const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [{ key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 }],
};

run('대상 정보 수정 현황 — 컨택원 단건 변경 (real DB)', () => {
  const surveyIds: string[] = [];

  afterAll(async () => {
    for (const id of surveyIds) await db.delete(surveys).where(eq(surveys.id, id));
  });

  async function seed() {
    const surveyId = randomUUID();
    surveyIds.push(surveyId);
    await db.insert(surveys).values({
      id: surveyId,
      title: '컨택원 변경 기록',
      contactColumns: scheme,
      testContactColumns: scheme,
    });
    const targetId = randomUUID();
    await db.insert(contactTargets).values({
      id: targetId,
      surveyId,
      resid: 1,
      attrs: {},
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

  it('배정 없음 → 컨택원으로 바꾸면 그 컨택원 이름을 담은 한 줄이 편집자와 함께 남는다', async () => {
    const { surveyId, targetId } = await seed();
    const tenth = await createAssignment({ surveyId, name: '10차' });

    await setTargetAssignment(
      { surveyId, contactTargetId: targetId, assignmentId: tenth.id },
      editor,
    );

    const logs = await logsOf(targetId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      surveyId,
      action: 'assignment_change',
      editedBy: 'editor-1',
      editorEmail: 'editor@local',
      changes: [{ kind: 'assignment', before: null, after: { id: tenth.id, name: '10차' } }],
    });
  });

  it('컨택원 → 컨택원 → 배정 없음 기록은 그때 이름이고, 나중에 이름을 바꿔도 옛 이름이 남는다', async () => {
    const { surveyId, targetId } = await seed();
    const tenth = await createAssignment({ surveyId, name: '10차' });
    const outsource = await createAssignment({ surveyId, name: '외주 A팀' });

    await setTargetAssignment(
      { surveyId, contactTargetId: targetId, assignmentId: tenth.id },
      editor,
    );
    await setTargetAssignment(
      { surveyId, contactTargetId: targetId, assignmentId: outsource.id },
      editor,
    );
    await setTargetAssignment({ surveyId, contactTargetId: targetId, assignmentId: null }, editor);
    await renameAssignment({ surveyId, id: tenth.id, name: '11차' });
    await renameAssignment({ surveyId, id: outsource.id, name: '외주 B팀' });

    expect((await logsOf(targetId)).map((l) => l.changes)).toEqual([
      [{ kind: 'assignment', before: null, after: { id: tenth.id, name: '10차' } }],
      [
        {
          kind: 'assignment',
          before: { id: tenth.id, name: '10차' },
          after: { id: outsource.id, name: '외주 A팀' },
        },
      ],
      [{ kind: 'assignment', before: { id: outsource.id, name: '외주 A팀' }, after: null }],
    ]);
  });

  it('같은 컨택원을 다시 고르거나 배정 없음을 다시 고르면 기록을 남기지 않는다', async () => {
    const { surveyId, targetId } = await seed();
    const tenth = await createAssignment({ surveyId, name: '10차' });

    await setTargetAssignment({ surveyId, contactTargetId: targetId, assignmentId: null }, editor);
    expect(await logsOf(targetId)).toEqual([]);

    await setTargetAssignment(
      { surveyId, contactTargetId: targetId, assignmentId: tenth.id },
      editor,
    );
    await setTargetAssignment(
      { surveyId, contactTargetId: targetId, assignmentId: tenth.id },
      editor,
    );
    expect(await logsOf(targetId)).toHaveLength(1);
    const [row] = await db
      .select({ assignmentId: contactTargets.assignmentId })
      .from(contactTargets)
      .where(eq(contactTargets.id, targetId));
    expect(row?.assignmentId).toBe(tenth.id);
  });

  it('게스트 화면 로더에는 컨택원 변경 줄이 실리지 않는다', async () => {
    const { surveyId, targetId } = await seed();
    const tenth = await createAssignment({ surveyId, name: '10차' });
    await setTargetAssignment(
      { surveyId, contactTargetId: targetId, assignmentId: tenth.id },
      editor,
    );

    expect(await getContactTargetEditLogs(targetId, 'real', { isGuest: true })).toEqual([]);
    const admin = await getContactTargetEditLogs(targetId, 'real', { isGuest: false });
    expect(admin).toHaveLength(1);
    expect(admin[0]).toMatchObject({ action: 'assignment_change', editorEmail: 'editor@local' });
  });

  /** 대상 행을 FOR UPDATE 로 쥔 트랜잭션 — release() 로 놓는다. */
  async function holdTarget(targetId: string) {
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
    return { holder, pid: await held, release };
  }

  async function assignmentOf(targetId: string) {
    const [row] = await db
      .select({ assignmentId: contactTargets.assignmentId })
      .from(contactTargets)
      .where(eq(contactTargets.id, targetId));
    return row?.assignmentId ?? null;
  }

  it('같은 대상을 동시에 바꾼 두 건은 줄을 서고, 각 기록은 자기 직전 컨택원을 이전 값으로 담는다', async () => {
    const { surveyId, targetId } = await seed();
    const tenth = await createAssignment({ surveyId, name: '10차' });
    const outsource = await createAssignment({ surveyId, name: '외주 A팀' });

    const lock = await holdTarget(targetId);
    // 둘 다 「배정 없음」을 보고 화면에서 골랐지만, 대상 잠금 뒤에 차례로 쓴다.
    const toTenth = setTargetAssignment(
      { surveyId, contactTargetId: targetId, assignmentId: tenth.id },
      { id: 'a', email: 'a@local' },
    );
    await waitForLockWaitersBehind(lock.pid, 1, '첫 변경이 대상 잠금 뒤에 줄 서지 않았다');
    const toOutsource = setTargetAssignment(
      { surveyId, contactTargetId: targetId, assignmentId: outsource.id },
      { id: 'b', email: 'b@local' },
    );
    await waitForLockWaitersBehind(lock.pid, 2, '두 번째 변경이 줄 서지 않았다');
    lock.release();
    await Promise.all([lock.holder, toTenth, toOutsource]);

    const logs = (await logsOf(targetId)).map((l) => l.changes[0]);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ kind: 'assignment', before: null });
    expect(logs[1]).toMatchObject({
      kind: 'assignment',
      before: (logs[0] as { after: unknown }).after,
    });
    expect(await assignmentOf(targetId)).toBe((logs[1] as { after: { id: string } }).after.id);
  });

  it('대상 잠금을 기다리는 단건 변경과 앞 컨택원 지우기가 교착 없이 끝나고 기록은 그때 이름이다', async () => {
    const { surveyId, targetId } = await seed();
    const tenth = await createAssignment({ surveyId, name: '10차' });
    const outsource = await createAssignment({ surveyId, name: '외주 A팀' });
    await setTargetAssignment(
      { surveyId, contactTargetId: targetId, assignmentId: tenth.id },
      editor,
    );

    const lock = await holdTarget(targetId);
    // 단건 변경은 새 컨택원(외주 A팀)을 잡고 대상을 기다린다.
    const change = setTargetAssignment(
      { surveyId, contactTargetId: targetId, assignmentId: outsource.id },
      editor,
    );
    await waitForLockWaitersBehind(lock.pid, 1, '단건 변경이 대상 잠금 뒤에 줄 서지 않았다');
    // 지우기는 앞 컨택원(10차)을 잡고 FK(SET NULL)로 같은 대상을 기다린다.
    const remove = removeAssignment({ surveyId, id: tenth.id });
    await waitForLockWaitersBehind(lock.pid, 2, '지우기가 대상 잠금 뒤에 줄 서지 않았다');
    lock.release();
    await Promise.all([lock.holder, change, remove]);

    expect(await assignmentOf(targetId)).toBe(outsource.id);
    expect((await logsOf(targetId)).at(-1)?.changes).toEqual([
      {
        kind: 'assignment',
        before: { id: tenth.id, name: '10차' },
        after: { id: outsource.id, name: '외주 A팀' },
      },
    ]);
  });

  it('대상 잠금을 기다리는 단건 변경과 다른 컨택원 교체 적용이 교착 없이 끝난다', async () => {
    const { surveyId, targetId } = await seed();
    const tenth = await createAssignment({ surveyId, name: '10차' });
    const outsource = await createAssignment({ surveyId, name: '외주 A팀' });

    const lock = await holdTarget(targetId);
    const change = setTargetAssignment(
      { surveyId, contactTargetId: targetId, assignmentId: tenth.id },
      editor,
    );
    await waitForLockWaitersBehind(lock.pid, 1, '단건 변경이 대상 잠금 뒤에 줄 서지 않았다');
    // 교체 적용은 자기 컨택원(외주 A팀)을 잡고 조건에 맞는 같은 대상을 기다린다.
    const apply = applyAssignment({
      surveyId,
      assignmentId: outsource.id,
      clauses: [{ source: 'system.resid', value: '1', op: '' }],
    });
    await waitForLockWaitersBehind(lock.pid, 2, '교체 적용이 대상 잠금 뒤에 줄 서지 않았다');
    lock.release();
    await Promise.all([lock.holder, change, apply]);

    // 단건 변경이 먼저 쓰고, 교체 적용이 그 위에 덮는다(마지막 배정이 이긴다). 일괄 배정은 기록하지 않는다.
    expect(await assignmentOf(targetId)).toBe(outsource.id);
    expect((await logsOf(targetId)).map((l) => l.changes)).toEqual([
      [{ kind: 'assignment', before: null, after: { id: tenth.id, name: '10차' } }],
    ]);
  });
});
