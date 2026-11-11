import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { contactPii, contactTargets, surveyResponses, surveys } from '@/db/schema';
import { upsertPiiValue } from '@/lib/crypto/contact-pii-repo';
import { generateInviteCode } from '@/lib/survey-url';
import { ensureTestContactColumns } from '@/server/contacts/services/test-contact-columns';
import { ensureTestSendTarget } from '@/server/contacts/services/test-send-target';
import { loadSendEmailForTarget } from '@/server/read-models/send-address';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

// 이 브라우저는 실데이터를 보는 중이다(테스트 보기 쿠키 없음) — 그래도 사본은 테스트 파티션에 서야 한다.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const run = process.env['RUN_REALDB'] === '1' && isLocalDb ? describe : describe.skip;

const REAL_SCHEME: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: '전시회명', label: '전시회명', source: 'attrs.전시회명', order: 1 },
    { key: '개최기간', label: '개최기간', source: 'attrs.개최기간', order: 2 },
    { key: '담당자', label: '담당자', source: 'pii.담당자', order: 3, piiType: 'name' },
    { key: '이메일', label: '이메일', source: 'pii.이메일', order: 4, piiType: 'email' },
  ],
};
const ATTRS = { 전시회명: '서울국제전시회', 개최기간: '2026.11.01~11.03' };

run('테스트 발송용 테스트 사본 대상자 (실DB)', () => {
  const surveyIds: string[] = [];

  afterAll(async () => {
    for (const id of surveyIds) await db.delete(surveys).where(eq(surveys.id, id));
  });

  /** seedTestTarget = 담당자가 이미 「테스트 조사 대상자 생성」을 한 설문(테스트 대상자 1명) */
  async function newSurvey(testModeEnabled: boolean, seedTestTarget = true) {
    const surveyId = randomUUID();
    await db.insert(surveys).values({
      id: surveyId,
      title: '테스트 발송 사본 실DB',
      contactColumns: REAL_SCHEME,
      testModeEnabled,
    });
    surveyIds.push(surveyId);
    const realId = randomUUID();
    await db.insert(contactTargets).values({
      id: realId,
      surveyId,
      resid: 1,
      isTest: false,
      groupValue: '수도권',
      attrs: ATTRS,
      inviteCode: generateInviteCode(),
    });
    await db.transaction(async (tx) => {
      await upsertPiiValue(tx, realId, '담당자', 'name', '실제담당자');
      await upsertPiiValue(tx, realId, '이메일', 'email', 'real-person@example.com');
    });
    if (seedTestTarget) {
      await db.insert(contactTargets).values({
        surveyId,
        resid: 1,
        isTest: true,
        attrs: { test_company: '견본 회사' },
        inviteCode: generateInviteCode(),
      });
      await db
        .update(surveys)
        .set({ testContactColumns: ensureTestContactColumns(REAL_SCHEME, null) })
        .where(eq(surveys.id, surveyId));
    }
    const [real] = await db.select().from(contactTargets).where(eq(contactTargets.id, realId));
    return { surveyId, real: real! };
  }

  const testTargets = (surveyId: string) =>
    db
      .select()
      .from(contactTargets)
      .where(and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, true)));

  it('실제 샘플이면 명단 값을 복사한 테스트 사본을 만들고 그 링크를 돌려준다 — 실제 링크·개인정보는 싣지 않는다', async () => {
    const { surveyId, real } = await newSurvey(true);

    const result = await ensureTestSendTarget({
      surveyId,
      sampleTargetId: real.id,
      recipientEmail: 'client@example.com',
      isGuest: false,
    });

    expect(result.kind).toBe('live');
    if (result.kind !== 'live') return;
    expect(result.created).toBe(true);
    expect(result.inviteCode).not.toBe(real.inviteCode);

    const clones = (await testTargets(surveyId)).filter((t) => t.inviteCode === result.inviteCode);
    expect(await testTargets(surveyId)).toHaveLength(2);
    expect(clones).toHaveLength(1);
    const clone = clones[0]!;
    expect(clone.inviteCode).toBe(result.inviteCode);
    expect(clone.attrs).toEqual(ATTRS);
    expect(clone.groupValue).toBe('수도권');
    expect(clone.inviteToken).not.toBe(real.inviteToken);

    // 사본의 개인정보는 이메일(테스트 수신 주소) 한 칸뿐 — 실제 담당자 이름·주소는 없다
    const pii = await db.select().from(contactPii).where(eq(contactPii.contactTargetId, clone.id));
    expect(pii).toHaveLength(1);
    expect(await loadSendEmailForTarget({ id: clone.id, surveyId, isTest: true })).toBe(
      'client@example.com',
    );
    // 실제 대상자는 그대로다
    const reals = await db
      .select()
      .from(contactTargets)
      .where(and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, false)));
    expect(reals).toHaveLength(1);
  });

  it('같은 주소로 다시 보내면 사본을 다시 쓰고, 다른 주소면 새로 만든다', async () => {
    const { surveyId, real } = await newSurvey(true);
    const send = (recipientEmail: string) =>
      ensureTestSendTarget({ surveyId, sampleTargetId: real.id, recipientEmail, isGuest: false });

    const first = await send('client@example.com');
    const again = await send(' Client@Example.com ');
    expect(first.kind === 'live' && again.kind === 'live').toBe(true);
    if (first.kind !== 'live' || again.kind !== 'live') return;
    expect(again.created).toBe(false);
    expect(again.inviteCode).toBe(first.inviteCode);
    expect(await testTargets(surveyId)).toHaveLength(2);

    const other = await send('second@example.com');
    expect(other.kind === 'live' && other.created).toBe(true);
    expect(await testTargets(surveyId)).toHaveLength(3);
  });

  it('동시에 두 번 와도 사본은 하나다', async () => {
    const { surveyId, real } = await newSurvey(true);
    const send = () =>
      ensureTestSendTarget({
        surveyId,
        sampleTargetId: real.id,
        recipientEmail: 'client@example.com',
        isGuest: false,
      });

    const results = await Promise.all([send(), send(), send()]);
    const codes = new Set(results.map((r) => (r.kind === 'live' ? r.inviteCode : 'x')));
    expect(codes.size).toBe(1);
    expect(results.filter((r) => r.kind === 'live' && r.created)).toHaveLength(1);
    expect(await testTargets(surveyId)).toHaveLength(2);
  });

  it('테스트 모드가 꺼져 있거나 게스트면 아무것도 만들지 않고 견본으로 돌린다', async () => {
    const off = await newSurvey(false, false);
    expect(
      await ensureTestSendTarget({
        surveyId: off.surveyId,
        sampleTargetId: off.real.id,
        recipientEmail: 'client@example.com',
        isGuest: false,
      }),
    ).toEqual({ kind: 'sandbox', reason: 'test-mode-off' });
    expect(await testTargets(off.surveyId)).toHaveLength(0);

    const on = await newSurvey(true);
    expect(
      await ensureTestSendTarget({
        surveyId: on.surveyId,
        sampleTargetId: on.real.id,
        recipientEmail: 'client@example.com',
        isGuest: true,
      }),
    ).toEqual({ kind: 'sandbox', reason: 'guest' });
    expect(await testTargets(on.surveyId)).toHaveLength(1);
  });

  it('테스트 대상자가 한 명도 없으면 사본을 만들지 않는다 — 첫 테스트 대상자는 익명 테스트 링크와 그 응답을 없앤다', async () => {
    const { surveyId, real } = await newSurvey(true, false);
    const anonymousResponseId = randomUUID();
    await db.insert(surveyResponses).values({
      id: anonymousResponseId,
      surveyId,
      isTest: true,
      questionResponses: {},
    });

    expect(
      await ensureTestSendTarget({
        surveyId,
        sampleTargetId: real.id,
        recipientEmail: 'client@example.com',
        isGuest: false,
      }),
    ).toEqual({ kind: 'sandbox', reason: 'no-test-targets' });
    expect(await testTargets(surveyId)).toHaveLength(0);
    // 익명 테스트 응답이 그대로 남아 있다
    const kept = await db
      .select({ id: surveyResponses.id })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, anonymousResponseId));
    expect(kept).toHaveLength(1);
  });

  it('샘플이 테스트 대상자면 그 링크를 그대로 쓰고, 다른 설문의 대상자면 견본으로 돌린다', async () => {
    const { surveyId } = await newSurvey(true, false);
    const testId = randomUUID();
    const code = generateInviteCode();
    await db.insert(contactTargets).values({
      id: testId,
      surveyId,
      resid: 1,
      isTest: true,
      attrs: {},
      inviteCode: code,
    });

    expect(
      await ensureTestSendTarget({
        surveyId,
        sampleTargetId: testId,
        recipientEmail: 'client@example.com',
        isGuest: false,
      }),
    ).toEqual({ kind: 'live', inviteCode: code, created: false, attrs: {} });
    expect(await testTargets(surveyId)).toHaveLength(1);

    const other = await newSurvey(true);
    expect(
      await ensureTestSendTarget({
        surveyId,
        sampleTargetId: other.real.id,
        recipientEmail: 'client@example.com',
        isGuest: false,
      }),
    ).toEqual({ kind: 'sandbox', reason: 'sample-missing' });
  });

  it('리뷰 1 — 이메일 열이 둘이고 발송 순위가 둘째 열에 걸려 있어도 같은 주소로 다시 보내면 사본을 다시 쓴다', async () => {
    const { surveyId, real } = await newSurvey(true);
    const twoEmails: ContactColumnScheme = {
      ...ensureTestContactColumns(REAL_SCHEME, null),
      columns: [
        ...ensureTestContactColumns(REAL_SCHEME, null).columns,
        { key: '실무자메일', label: '실무자메일', source: 'pii.실무자메일', order: 99, piiType: 'email', mailOrder: 1 },
      ],
    };
    await db.update(surveys).set({ testContactColumns: twoEmails }).where(eq(surveys.id, surveyId));
    const send = () =>
      ensureTestSendTarget({ surveyId, sampleTargetId: real.id, recipientEmail: 'client@example.com', isGuest: false });

    const first = await send();
    const again = await send();
    expect(first.kind === 'live' && first.created).toBe(true);
    expect(again.kind === 'live' && again.created).toBe(false);
    expect(await testTargets(surveyId)).toHaveLength(2);
    // 사본의 주소는 실제 발송이 읽는 열에 있다
    if (first.kind === 'live') {
      const clone = (await testTargets(surveyId)).find((t) => t.inviteCode === first.inviteCode)!;
      expect(await loadSendEmailForTarget({ id: clone.id, surveyId, isTest: true })).toBe('client@example.com');
    }
  });

  it('리뷰 2 — 명단 값·주소가 같아도 다른 개인정보가 든 테스트 대상자는 다시 쓰지 않는다', async () => {
    const { surveyId, real } = await newSurvey(true);
    const manualId = randomUUID();
    await db.insert(contactTargets).values({
      id: manualId,
      surveyId,
      resid: 2,
      isTest: true,
      groupValue: '수도권',
      attrs: ATTRS,
      inviteCode: generateInviteCode(),
    });
    await db.transaction(async (tx) => {
      await upsertPiiValue(tx, manualId, '이메일', 'email', 'client@example.com');
      await upsertPiiValue(tx, manualId, '담당자', 'name', '손으로 넣은 이름');
    });
    const [manual] = await db.select().from(contactTargets).where(eq(contactTargets.id, manualId));

    const result = await ensureTestSendTarget({
      surveyId,
      sampleTargetId: real.id,
      recipientEmail: 'client@example.com',
      isGuest: false,
    });

    expect(result.kind === 'live' && result.created).toBe(true);
    if (result.kind === 'live') expect(result.inviteCode).not.toBe(manual!.inviteCode);
  });

  it('리뷰 4 — 그룹 값이 다른 테스트 대상자는 다시 쓰지 않는다', async () => {
    const { surveyId, real } = await newSurvey(true);
    const send = () =>
      ensureTestSendTarget({ surveyId, sampleTargetId: real.id, recipientEmail: 'client@example.com', isGuest: false });
    const first = await send();
    if (first.kind !== 'live') throw new Error('사본이 만들어지지 않았다');
    await db.update(contactTargets).set({ groupValue: '영남권' }).where(eq(contactTargets.inviteCode, first.inviteCode));

    const again = await send();

    expect(again.kind === 'live' && again.created).toBe(true);
    if (again.kind === 'live') expect(again.inviteCode).not.toBe(first.inviteCode);
  });

  it('리뷰 3 — 사본을 만든 명단 값을 함께 돌려준다(메일 본문이 같은 값을 쓰게)', async () => {
    const { surveyId, real } = await newSurvey(true);
    const result = await ensureTestSendTarget({
      surveyId,
      sampleTargetId: real.id,
      recipientEmail: 'client@example.com',
      isGuest: false,
    });
    expect(result).toMatchObject({ kind: 'live', attrs: ATTRS });
  });

  it('테스트 대상자가 20명이면 새 사본을 만들지 않고 정리하라는 문구를 돌려준다', async () => {
    const { surveyId, real } = await newSurvey(true, false);
    await db.insert(contactTargets).values(
      Array.from({ length: 20 }, (_, i) => ({
        surveyId,
        resid: i + 1,
        isTest: true,
        attrs: { 전시회명: `다른 전시회 ${i}` },
        inviteCode: generateInviteCode(),
      })),
    );

    const result = await ensureTestSendTarget({
      surveyId,
      sampleTargetId: real.id,
      recipientEmail: 'client@example.com',
      isGuest: false,
    });
    expect(result.kind).toBe('limit');
    if (result.kind === 'limit') expect(result.message).toContain('20명');
    expect(await testTargets(surveyId)).toHaveLength(20);
  });
});
