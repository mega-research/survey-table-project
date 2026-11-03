/**
 * 대상 정보 수정 현황 — 개인정보 열 변경 기록 실 DB 왕복 (.scratch/contact-edit-history/PRD.md 「판정」).
 *
 * 조사 대상 상세 저장(updateContactTarget)의 piiUpdates 가 값 없이 「입력 · 변경 · 삭제」로만 남는지,
 * 같은 저장의 attrs 변경과 한 줄에 담기는지, 기록 줄 어디에도 저장한 평문이 없는지를 본다.
 *
 * 실행: RUN_REALDB=1 DATABASE_URL=<로컬 DB> pnpm exec vitest run <이 파일>. 일반 pnpm test 에서는 스킵된다.
 */
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { contactPii, contactTargetEditLogs, contactTargets, surveys } from '@/db/schema';
import { upsertPiiValue } from '@/lib/crypto/contact-pii-repo';
import { updateContactTarget } from '@/server/contacts/services/contact-targets';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

// 요청 밖이라 쿠키가 없다 — 콘솔은 실데이터 파티션을 본다(server/data-scope).
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: '지역', label: '지역', source: 'attrs.지역', order: 1 },
    {
      key: '대표자휴대폰',
      label: '대표자 휴대폰번호',
      source: 'pii.대표자휴대폰',
      order: 2,
      piiType: 'phone',
    },
    {
      key: '담당자이메일',
      label: '담당자 이메일',
      source: 'pii.담당자이메일',
      order: 3,
      piiType: 'email',
    },
    { key: '대표자명', label: '대표자명', source: 'pii.대표자명', order: 4, piiType: 'name' },
  ],
};

const editor = { id: 'editor-1', email: 'editor@local' };

run('대상 정보 수정 현황 — 개인정보 열 (real DB)', () => {
  const surveyIds: string[] = [];

  afterAll(async () => {
    for (const id of surveyIds) await db.delete(surveys).where(eq(surveys.id, id));
  });

  async function seed(
    attrs: Record<string, string>,
    pii: { columnKey: string; fieldType: 'phone' | 'email' | 'name'; plain: string }[] = [],
  ) {
    const surveyId = randomUUID();
    surveyIds.push(surveyId);
    await db.insert(surveys).values({
      id: surveyId,
      title: '대상 정보 수정 현황 pii',
      contactColumns: scheme,
      testContactColumns: scheme,
    });
    const targetId = randomUUID();
    await db.insert(contactTargets).values({
      id: targetId,
      surveyId,
      resid: 1,
      attrs,
      inviteCode: randomUUID(),
    });
    await db.transaction(async (tx) => {
      for (const p of pii) await upsertPiiValue(tx, targetId, p.columnKey, p.fieldType, p.plain);
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

  it('입력 · 변경 · 삭제가 값 없이 op 셋으로 남는다', async () => {
    const { surveyId, targetId } = await seed({ 지역: '서울' }, [
      { columnKey: '대표자휴대폰', fieldType: 'phone', plain: '010-1111-2222' },
      { columnKey: '대표자명', fieldType: 'name', plain: '김옛이름' },
    ]);

    await updateContactTarget(
      {
        id: targetId,
        surveyId,
        attrs: { 지역: '서울' },
        piiUpdates: [
          { columnKey: '대표자휴대폰', fieldType: 'phone', plain: '010-3333-4444' },
          { columnKey: '담당자이메일', fieldType: 'email', plain: 'new@example.com' },
          { columnKey: '대표자명', fieldType: 'name', plain: '' },
        ],
      },
      false,
      editor,
    );

    const logs = await logsOf(targetId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'info_edit', editorEmail: 'editor@local' });
    expect(logs[0]!.changes).toEqual([
      { kind: 'pii', key: '대표자휴대폰', label: '대표자 휴대폰번호', op: 'changed' },
      { kind: 'pii', key: '담당자이메일', label: '담당자 이메일', op: 'set' },
      { kind: 'pii', key: '대표자명', label: '대표자명', op: 'cleared' },
    ]);

    // 기록 줄 JSON 전체에 저장 전후 평문이 어디에도 없다 — 이력이 개인정보 사본이 되지 않는다.
    const serialized = JSON.stringify(logs[0]);
    for (const plain of [
      '010-3333-4444',
      '01033334444',
      '010-1111-2222',
      'new@example.com',
      '김옛이름',
    ]) {
      expect(serialized).not.toContain(plain);
    }
    // 실제 저장은 그대로 일어났다.
    const piiRows = await db
      .select({ columnKey: contactPii.columnKey })
      .from(contactPii)
      .where(eq(contactPii.contactTargetId, targetId));
    expect(piiRows.map((r) => r.columnKey).sort()).toEqual(['담당자이메일', '대표자휴대폰']);
  });

  it('같은 값을 다시 저장하면 기록이 없다', async () => {
    const { surveyId, targetId } = await seed({ 지역: '서울' }, [
      { columnKey: '대표자휴대폰', fieldType: 'phone', plain: '010-1111-2222' },
    ]);

    await updateContactTarget(
      {
        id: targetId,
        surveyId,
        attrs: { 지역: '서울' },
        piiUpdates: [
          { columnKey: '대표자휴대폰', fieldType: 'phone', plain: '010-1111-2222' },
          // 지금 행이 없는 열을 비운 채 보내도 아무 일도 아니다.
          { columnKey: '담당자이메일', fieldType: 'email', plain: '' },
        ],
      },
      false,
      editor,
    );

    expect(await logsOf(targetId)).toEqual([]);
  });

  it('pii 변경은 같은 저장의 attrs 변경과 한 줄에 담긴다', async () => {
    const { surveyId, targetId } = await seed({ 지역: '서울' });

    await updateContactTarget(
      {
        id: targetId,
        surveyId,
        attrs: { 지역: '부산' },
        piiUpdates: [{ columnKey: '대표자휴대폰', fieldType: 'phone', plain: '010-5555-6666' }],
      },
      false,
      editor,
    );

    const logs = await logsOf(targetId);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.changes).toEqual([
      { kind: 'attr', key: '지역', label: '지역', before: '서울', after: '부산' },
      { kind: 'pii', key: '대표자휴대폰', label: '대표자 휴대폰번호', op: 'set' },
    ]);
  });

  it('지금 값을 복호화할 수 없는 열을 덮어쓰면 변경으로 남는다', async () => {
    const { surveyId, targetId } = await seed({ 지역: '서울' }, [
      { columnKey: '대표자휴대폰', fieldType: 'phone', plain: '010-1111-2222' },
    ]);
    await db
      .update(contactPii)
      .set({ cipher: 'not-a-valid-cipher' })
      .where(eq(contactPii.contactTargetId, targetId));

    await updateContactTarget(
      {
        id: targetId,
        surveyId,
        attrs: { 지역: '서울' },
        piiUpdates: [{ columnKey: '대표자휴대폰', fieldType: 'phone', plain: '010-1111-2222' }],
      },
      false,
      editor,
    );

    const logs = await logsOf(targetId);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.changes).toEqual([
      { kind: 'pii', key: '대표자휴대폰', label: '대표자 휴대폰번호', op: 'changed' },
    ]);
  });

  it('열 이름은 저장 시점 스킴의 이름이고, 스킴에 없는 열은 키를 이름으로 쓴다', async () => {
    const { surveyId, targetId } = await seed({ 지역: '서울' });

    await updateContactTarget(
      {
        id: targetId,
        surveyId,
        attrs: { 지역: '서울' },
        piiUpdates: [{ columnKey: '옛휴대폰', fieldType: 'phone', plain: '010-7777-8888' }],
      },
      false,
      editor,
    );
    // 나중에 열 이름을 바꿔도 기록은 그때 이름 그대로다.
    await db
      .update(surveys)
      .set({
        contactColumns: {
          ...scheme,
          columns: [
            ...scheme.columns,
            {
              key: '옛휴대폰',
              label: '새 이름',
              source: 'pii.옛휴대폰',
              order: 9,
              piiType: 'phone',
            },
          ],
        },
      })
      .where(eq(surveys.id, surveyId));

    const logs = await logsOf(targetId);
    expect(logs[0]!.changes).toEqual([
      { kind: 'pii', key: '옛휴대폰', label: '옛휴대폰', op: 'set' },
    ]);
  });
});
