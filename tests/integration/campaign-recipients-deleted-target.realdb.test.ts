import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  contactTargets,
  mailCampaigns,
  mailRecipients,
  surveys,
} from '@/db/schema';
import { listCampaignRecipients } from '@/lib/operations/campaigns.server';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

run('삭제된 대상자의 캠페인 수신자 보존', () => {
  const surveyId = randomUUID();

  afterAll(async () => {
    await db.delete(surveys).where(eq(surveys.id, surveyId));
  });

  it('ON DELETE SET NULL 후에도 total과 rows에 같은 수신자를 반환한다', async () => {
    const targetId = randomUUID();
    const campaignId = randomUUID();
    const recipientId = randomUUID();

    await db.insert(surveys).values({ id: surveyId, title: '캠페인 수신자 보존 테스트' });
    await db.insert(contactTargets).values({
      id: targetId,
      surveyId,
      resid: 1,
      inviteCode: randomUUID(),
      groupValue: '테스트 그룹',
    });
    await db.insert(mailCampaigns).values({
      id: campaignId,
      surveyId,
      runNumber: 1,
      title: '보존 테스트',
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
    });
    await db.insert(mailRecipients).values({
      id: recipientId,
      campaignId,
      contactTargetId: targetId,
      emailSnapshot: 'archive@example.com',
      inviteTokenSnapshot: randomUUID(),
    });

    await db.delete(contactTargets).where(eq(contactTargets.id, targetId));

    const result = await listCampaignRecipients({
      surveyId,
      campaignId,
      scope: 'real',
    });

    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: recipientId,
      contactTargetId: null,
      contactResid: null,
      contactGroupValue: null,
      emailMasked: 'ar***@***.com',
      unsubscribedAt: null,
    });
  });
});
