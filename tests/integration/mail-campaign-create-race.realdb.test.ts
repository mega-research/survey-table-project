import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const resultCodeGate = vi.hoisted(() => ({
  entered: null as (() => void) | null,
  wait: null as Promise<void> | null,
}));

vi.mock('@/lib/crypto/aes', () => ({
  decryptPii: vi.fn(() => 'qa@example.com'),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn(async () => undefined) },
}));

vi.mock('@/lib/operations/result-code-statuses.server', async () => {
  const { mockBuildNegativeCodeExists } = await import('./_helpers/result-code-mock');
  return {
    getResultCodeStatuses: vi.fn(async () => {
      resultCodeGate.entered?.();
      if (resultCodeGate.wait) await resultCodeGate.wait;
      return { positive: [], negative: [] };
    }),
    buildNegativeCodeExists: mockBuildNegativeCodeExists,
  };
});

import { db } from '@/db';
import { createCampaign } from '@/features/mail/server/services/mail-campaigns.service';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;
const surveyIds: string[] = [];

interface CampaignFixture {
  surveyId: string;
  templateId: string;
  realTargetId: string;
  testTargetId: string;
}

async function seedCampaignFixture(): Promise<CampaignFixture> {
  const surveyId = randomUUID();
  const templateId = randomUUID();
  const realTargetId = randomUUID();
  const testTargetId = randomUUID();
  surveyIds.push(surveyId);

  await db.execute(sql`
    INSERT INTO surveys (id,title,test_mode_enabled)
    VALUES (${surveyId},'campaign-race',true)
  `);
  await db.execute(sql`
    INSERT INTO mail_templates (
      id,survey_id,name,subject,body_html,from_local,from_name
    ) VALUES (
      ${templateId},${surveyId},'template','subject','<p>body</p>','noreply','sender'
    )
  `);
  await db.execute(sql`
    INSERT INTO contact_targets (id,survey_id,resid,is_test,invite_code)
    VALUES (${realTargetId},${surveyId},1,false,${randomUUID()}),
           (${testTargetId},${surveyId},1,true,${randomUUID()})
  `);
  await db.execute(sql`
    INSERT INTO contact_pii (
      contact_target_id,field_type,column_key,cipher,blind_index
    ) VALUES (${realTargetId},'email','email','cipher','real-index'),
             (${testTargetId},'email','email','cipher','test-index')
  `);

  return { surveyId, templateId, realTargetId, testTargetId };
}

function campaignInput(
  fixture: CampaignFixture,
  targetId: string,
  title: string,
) {
  return {
    surveyId: fixture.surveyId,
    mailTemplateId: fixture.templateId,
    title,
    contactTargetIds: [targetId],
  };
}

async function waitForModeFlipLock(): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const rows = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname=current_database()
        AND wait_event_type='Lock'
        AND query ILIKE '%UPDATE surveys SET test_mode_enabled%'
    `);
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('test_mode_enabled UPDATE lock 대기를 관찰하지 못했습니다');
}

run('메일 캠페인 생성 DB 경쟁', () => {
  afterEach(async () => {
    resultCodeGate.entered = null;
    resultCodeGate.wait = null;
    while (surveyIds.length > 0) {
      const surveyId = surveyIds.pop();
      if (surveyId) await db.execute(sql`DELETE FROM surveys WHERE id=${surveyId}`);
    }
  });

  it('동시 생성은 scope별로 중복 없는 회차를 발번한다', async () => {
    const fixture = await seedCampaignFixture();

    await Promise.all([
      createCampaign(campaignInput(fixture, fixture.testTargetId, 'test-a'), randomUUID()),
      createCampaign(campaignInput(fixture, fixture.testTargetId, 'test-b'), randomUUID()),
    ]);
    await db.execute(
      sql`UPDATE surveys SET test_mode_enabled=false WHERE id=${fixture.surveyId}`,
    );
    await createCampaign(
      campaignInput(fixture, fixture.realTargetId, 'real-a'),
      randomUUID(),
    );

    const rows = await db.execute<{ is_test: boolean; run_number: number }>(sql`
      SELECT is_test,run_number
      FROM mail_campaigns
      WHERE survey_id=${fixture.surveyId}
      ORDER BY is_test,run_number
    `);
    expect(rows).toEqual([
      { is_test: false, run_number: 1 },
      { is_test: true, run_number: 1 },
      { is_test: true, run_number: 2 },
    ]);
  });

  it('모드 전환은 생성의 survey SHARE lock 뒤에 직렬화된다', async () => {
    const fixture = await seedCampaignFixture();
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    resultCodeGate.entered = markEntered;
    resultCodeGate.wait = wait;

    const creation = createCampaign(
      campaignInput(fixture, fixture.testTargetId, 'locked-test'),
      randomUUID(),
    );
    await entered;
    const modeFlip = (async () => db.execute(
      sql`UPDATE surveys SET test_mode_enabled=false WHERE id=${fixture.surveyId}`,
    ))();

    try {
      await waitForModeFlipLock();
    } finally {
      release();
    }
    await Promise.all([creation, modeFlip]);
    resultCodeGate.entered = null;
    resultCodeGate.wait = null;

    const campaigns = await db.execute<{ is_test: boolean }>(sql`
      SELECT is_test FROM mail_campaigns WHERE survey_id=${fixture.surveyId}
    `);
    expect(campaigns).toEqual([{ is_test: true }]);
    await expect(
      createCampaign(
        campaignInput(fixture, fixture.testTargetId, 'stale-test'),
        randomUUID(),
      ),
    ).rejects.toThrow('화면을 새로고침');
  });
});
