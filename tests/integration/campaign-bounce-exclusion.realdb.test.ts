import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  contactPii,
  contactTargets,
  mailCampaigns,
  mailRecipients,
  surveys,
} from '@/db/schema';
import { buildPiiRows, type PiiInput } from '@/lib/crypto/contact-pii-repo';
import { listBouncedContactIds } from '@/lib/operations/campaigns.server';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

run('반송 이력 제외 — 주소 단위 판정', () => {
  const surveyIds: string[] = [];
  // resid(설문내 UNIQUE)와 run_number(설문내 UNIQUE) 충돌을 피하는 전역 시퀀스
  let seq = 0;

  afterAll(async () => {
    for (const id of surveyIds) {
      await db.delete(surveys).where(eq(surveys.id, id));
    }
  });

  async function newSurvey(title: string): Promise<string> {
    const id = randomUUID();
    await db.insert(surveys).values({ id, title });
    surveyIds.push(id);
    return id;
  }

  /** 컨택 1건 + email PII 컬럼 생성. columns 는 [columnKey, 평문 주소] 쌍. */
  async function seedContact(
    surveyId: string,
    columns: Array<[string, string]>,
  ): Promise<string> {
    const id = randomUUID();
    seq += 1;
    await db.insert(contactTargets).values({
      id,
      surveyId,
      resid: seq,
      inviteCode: randomUUID(),
    });
    const inputs: PiiInput[] = columns.map(([columnKey, plain]) => ({
      columnKey,
      fieldType: 'email',
      plain,
    }));
    const rows = buildPiiRows(id, inputs);
    if (rows.length > 0) await db.insert(contactPii).values(rows);
    return id;
  }

  /** 캠페인 1건 + 반송 수신자 1건 생성. contactTargetId 는 null 일 수 있다. */
  async function seedBounce(
    surveyId: string,
    contactTargetId: string | null,
    emailSnapshot: string,
  ): Promise<void> {
    const campaignId = randomUUID();
    seq += 1;
    await db.insert(mailCampaigns).values({
      id: campaignId,
      surveyId,
      runNumber: seq,
      title: '반송 판정 테스트',
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
    });
    await db.insert(mailRecipients).values({
      id: randomUUID(),
      campaignId,
      contactTargetId,
      emailSnapshot,
      inviteTokenSnapshot: randomUUID(),
      status: 'bounced',
    });
  }

  it('컨택을 삭제하고 같은 주소로 재등록해도 반송 이력이 유지된다', async () => {
    const surveyId = await newSurvey('교체 후 반송 이력 보존');
    const oldId = await seedContact(surveyId, [['이메일', 'dead@example.com']]);
    await seedBounce(surveyId, oldId, 'dead@example.com');

    // 조사대상자 교체 업로드 시뮬레이션 — mail_recipients.contact_target_id 는 SET NULL 된다
    await db.delete(contactTargets).where(eq(contactTargets.id, oldId));
    const newId = await seedContact(surveyId, [['이메일', 'dead@example.com']]);

    expect(await listBouncedContactIds(surveyId)).toEqual([newId]);
  });

  it('반송 주소와 다른 주소를 쓰는 컨택은 제외하지 않는다', async () => {
    const surveyId = await newSurvey('병합으로 주소 변경');
    const id = await seedContact(surveyId, [['이메일', 'changed@example.com']]);
    await seedBounce(surveyId, id, 'old-dead@example.com');

    expect(await listBouncedContactIds(surveyId)).toEqual([]);
  });

  it('반송 이력이 없는 설문은 빈 배열을 반환한다', async () => {
    const surveyId = await newSurvey('반송 이력 없음');
    await seedContact(surveyId, [['이메일', 'fresh@example.com']]);

    expect(await listBouncedContactIds(surveyId)).toEqual([]);
  });

  it('다른 설문의 반송 이력은 넘어오지 않는다', async () => {
    const otherSurveyId = await newSurvey('타 설문 반송');
    await seedBounce(otherSurveyId, null, 'shared@example.com');

    const surveyId = await newSurvey('타 설문과 같은 주소');
    const id = await seedContact(surveyId, [['이메일', 'shared@example.com']]);

    expect(await listBouncedContactIds(surveyId)).toEqual([]);
    expect(await listBouncedContactIds(otherSurveyId)).toEqual([]);
    expect(id).toBeTruthy();
  });

  it('발송에 쓰이지 않는 보조 email 컬럼이 반송된 경우 제외하지 않는다', async () => {
    const surveyId = await newSurvey('보조 메일만 반송');
    // 발송은 column_key 알파벳 순 첫 컬럼을 쓴다 — '1_대표메일' < '2_담당메일'
    const id = await seedContact(surveyId, [
      ['1_대표메일', 'primary@example.com'],
      ['2_담당메일', 'secondary@example.com'],
    ]);
    await seedBounce(surveyId, id, 'secondary@example.com');

    expect(await listBouncedContactIds(surveyId)).toEqual([]);
  });

  it('발송 주소인 첫 email 컬럼이 반송된 경우 제외한다', async () => {
    const surveyId = await newSurvey('대표 메일 반송');
    const id = await seedContact(surveyId, [
      ['1_대표메일', 'primary-dead@example.com'],
      ['2_담당메일', 'backup@example.com'],
    ]);
    await seedBounce(surveyId, id, 'primary-dead@example.com');

    expect(await listBouncedContactIds(surveyId)).toEqual([id]);
  });
});
