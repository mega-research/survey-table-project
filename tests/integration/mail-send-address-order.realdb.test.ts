import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { contactPii, contactTargets, mailRecipients, mailTemplates, surveys } from '@/db/schema';
import { buildPiiRows, type PiiInput } from '@/lib/crypto/contact-pii-repo';
import { createCampaign } from '@/server/mail/services/campaigns';
import { preflightRecipients } from '@/server/mail/services/campaigns-read';
import { lookupContactByToken } from '@/server/mail/services/unsubscribe';
import { getContactSampleById } from '@/server/read-models/contact-sample';
import { loadBouncedAddresses } from '@/server/read-models/send-address';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn(async () => undefined) },
}));

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

const CEO = '대표자 e-mail';
const STAFF = '실무자 e-mail';
const STAFF2 = '실무자 e-mail__2';

/** 컬럼 설정 — ranked 는 1순위부터. 여기 없는 이메일 열은 순위가 없다. */
function scheme(ranked: string[]): ContactColumnScheme {
  return {
    version: 1,
    headerRow: 1,
    columns: [CEO, STAFF, STAFF2].map((key, i) => {
      const rank = ranked.indexOf(key);
      return {
        key,
        label: key,
        source: `pii.${key}` as const,
        order: i + 1,
        piiType: 'email' as const,
        ...(rank >= 0 ? { mailOrder: rank + 1 } : {}),
      };
    }),
  };
}

run('메일 발송 주소 순서 — 컬럼 설정이 실제 발송 주소를 정한다', () => {
  const surveyIds: string[] = [];
  let seq = 0;

  afterAll(async () => {
    for (const id of surveyIds) await db.delete(surveys).where(eq(surveys.id, id));
  });

  async function newSurvey(ranked: string[] | null): Promise<{ surveyId: string; templateId: string }> {
    const surveyId = randomUUID();
    const templateId = randomUUID();
    await db
      .insert(surveys)
      .values({ id: surveyId, title: '발송 주소 순서', contactColumns: ranked ? scheme(ranked) : null });
    surveyIds.push(surveyId);
    await db.insert(mailTemplates).values({
      id: templateId,
      surveyId,
      name: 'template',
      subject: 'subject',
      bodyHtml: '<p>body</p>',
      fromLocal: 'noreply',
      fromName: 'sender',
    });
    return { surveyId, templateId };
  }

  async function seedContact(surveyId: string, columns: Array<[string, string]>): Promise<string> {
    const id = randomUUID();
    seq += 1;
    await db.insert(contactTargets).values({ id, surveyId, resid: seq, inviteCode: randomUUID() });
    const inputs: PiiInput[] = columns.map(([columnKey, plain]) => ({
      columnKey,
      fieldType: 'email',
      plain,
    }));
    const rows = buildPiiRows(id, inputs);
    if (rows.length > 0) await db.insert(contactPii).values(rows);
    return id;
  }

  async function sentAddresses(campaignId: string): Promise<Map<string | null, string | null>> {
    const rows = await db
      .select({ id: mailRecipients.contactTargetId, email: mailRecipients.emailSnapshot })
      .from(mailRecipients)
      .where(eq(mailRecipients.campaignId, campaignId));
    return new Map(rows.map((r) => [r.id, r.email]));
  }

  it('순서가 없으면 종전대로 열 이름순 첫 열(대표자)로 보낸다', async () => {
    const { surveyId, templateId } = await newSurvey(null);
    const id = await seedContact(surveyId, [
      [CEO, 'ceo@example.com'],
      [STAFF, 'staff@example.com'],
    ]);

    const result = await createCampaign(
      { surveyId, mailTemplateId: templateId, title: '기본', contactTargetIds: [id] },
      { accountUserId: randomUUID(), fieldworkLinkId: null },
      false,
    );

    expect((await sentAddresses(result.campaignId)).get(id)).toBe('ceo@example.com');
  });

  it('실무자 → 실무자2 → 대표자 순서면 값이 있는 가장 앞 순위 주소로 보낸다', async () => {
    const { surveyId, templateId } = await newSurvey([STAFF, STAFF2, CEO]);
    const both = await seedContact(surveyId, [
      [CEO, 'ceo-a@example.com'],
      [STAFF, 'staff-a@example.com'],
    ]);
    const secondStaffOnly = await seedContact(surveyId, [
      [CEO, 'ceo-b@example.com'],
      [STAFF2, 'staff2-b@example.com'],
    ]);
    const ceoOnly = await seedContact(surveyId, [[CEO, 'ceo-c@example.com']]);

    const result = await createCampaign(
      {
        surveyId,
        mailTemplateId: templateId,
        title: '실무자 우선',
        contactTargetIds: [both, secondStaffOnly, ceoOnly],
      },
      { accountUserId: randomUUID(), fieldworkLinkId: null },
      false,
    );

    const sent = await sentAddresses(result.campaignId);
    expect(sent.get(both)).toBe('staff-a@example.com');
    expect(sent.get(secondStaffOnly)).toBe('staff2-b@example.com');
    expect(sent.get(ceoOnly)).toBe('ceo-c@example.com');

    // 미리보기와 수신거부 화면도 같은 주소를 본다.
    expect((await getContactSampleById(surveyId, both, 'real'))?.email).toBe('staff-a@example.com');
    const [target] = await db
      .select({ token: contactTargets.unsubscribeToken })
      .from(contactTargets)
      .where(eq(contactTargets.id, both));
    const lookup = await lookupContactByToken({ token: target?.token ?? '' });
    expect(lookup.email).toBe('sta...@exa...');
  });

  it('순서에 넣지 않은 열로는 보내지 않는다 — 사전 점검도 이메일 누락으로 센다', async () => {
    const { surveyId, templateId } = await newSurvey([STAFF]);
    const hasStaff = await seedContact(surveyId, [
      [CEO, 'ceo-d@example.com'],
      [STAFF, 'staff-d@example.com'],
    ]);
    const ceoOnly = await seedContact(surveyId, [[CEO, 'ceo-e@example.com']]);

    const preflight = await preflightRecipients({
      surveyId,
      scope: 'real',
      selectedContactIds: [hasStaff, ceoOnly],
      bounced: await loadBouncedAddresses(surveyId),
    });
    expect(preflight.validIds).toEqual([hasStaff]);
    expect(preflight.emailMissingIds).toEqual([ceoOnly]);

    const result = await createCampaign(
      {
        surveyId,
        mailTemplateId: templateId,
        title: '대표자 제외',
        contactTargetIds: [hasStaff, ceoOnly],
      },
      { accountUserId: randomUUID(), fieldworkLinkId: null },
      false,
    );
    const sent = await sentAddresses(result.campaignId);
    expect(sent.get(hasStaff)).toBe('staff-d@example.com');
    expect(sent.has(ceoOnly)).toBe(false);
  });
});
