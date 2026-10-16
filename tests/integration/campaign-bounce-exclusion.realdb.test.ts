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
import {
  buildPiiRows,
  type PiiInput,
  selectEmailPiiRows,
} from '@/lib/crypto/contact-pii-repo';
import { listBouncedContactIds } from '@/server/mail/services/campaigns-read';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

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

  // 2026-10-16 대체 발송과 함께 바꿨다 — 1순위 열이 반송돼도 다음 순위 열이 남아 있으면 발송은 그 열로
  // 넘어가므로 제외하지 않는다. 보낼 열이 하나도 남지 않을 때만 제외한다.
  it('첫 email 컬럼이 반송돼도 다음 순위 열이 남아 있으면 제외하지 않고, 후보 열이 전부 반송이면 제외한다', async () => {
    const surveyId = await newSurvey('대표 메일 반송');
    const hasBackup = await seedContact(surveyId, [
      ['1_대표메일', 'primary-dead@example.com'],
      ['2_담당메일', 'backup@example.com'],
    ]);
    const allDead = await seedContact(surveyId, [
      ['1_대표메일', 'p-dead@example.com'],
      ['2_담당메일', 'b-dead@example.com'],
    ]);
    await seedBounce(surveyId, hasBackup, 'primary-dead@example.com');
    await seedBounce(surveyId, allDead, 'p-dead@example.com');
    await seedBounce(surveyId, allDead, 'b-dead@example.com');

    expect(await listBouncedContactIds(surveyId)).toEqual([allDead]);
  });

  /** 컬럼 설정에 발송 주소 순서를 건다 — keys 는 1순위부터. */
  function orderedScheme(keys: string[], allKeys: string[]): ContactColumnScheme {
    return {
      version: 1,
      headerRow: 1,
      columns: allKeys.map((key, i) => {
        const rank = keys.indexOf(key);
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

  it('발송 주소 순서를 지정하면 그 순서에 든 열만 후보로 보고, 후보가 모두 반송된 컨택만 제외한다', async () => {
    const surveyId = await newSurvey('순서 지정 — 실무자 우선');
    await db
      .update(surveys)
      .set({
        contactColumns: orderedScheme(
          ['실무자 e-mail', '대표자 e-mail'],
          ['대표자 e-mail', '실무자 e-mail'],
        ),
      })
      .where(eq(surveys.id, surveyId));
    // 열 이름순으로는 '대표자 e-mail' 이 먼저다 — 순서 지정이 이를 뒤집는다.
    const ceoBounced = await seedContact(surveyId, [
      ['대표자 e-mail', 'ceo-dead@example.com'],
      ['실무자 e-mail', 'staff@example.com'],
    ]);
    const staffBounced = await seedContact(surveyId, [
      ['대표자 e-mail', 'ceo@example.com'],
      ['실무자 e-mail', 'staff-dead@example.com'],
    ]);
    // 순서에 든 열만 후보다 — 실무자 열만 있고 그 주소가 반송된 컨택은 보낼 열이 없다.
    const staffOnlyDead = await seedContact(surveyId, [['실무자 e-mail', 'staff-only-dead@example.com']]);
    await seedBounce(surveyId, ceoBounced, 'ceo-dead@example.com');
    await seedBounce(surveyId, staffBounced, 'staff-dead@example.com');
    await seedBounce(surveyId, staffOnlyDead, 'staff-only-dead@example.com');

    // 둘 다 반송 안 된 다른 순위 열이 남아 있어 발송은 그 열로 넘어간다 — 제외되지 않는다.
    expect(await listBouncedContactIds(surveyId)).toEqual([staffOnlyDead]);

    const rows = await selectEmailPiiRows(db, [ceoBounced], ['실무자 e-mail', '대표자 e-mail']);
    expect(rows.map((r) => r.columnKey)).toEqual(['실무자 e-mail', '대표자 e-mail']);
  });

  it('순서에 넣지 않은 열은 발송 주소 후보가 아니다 — 그 주소의 반송으로 제외하지 않는다', async () => {
    const surveyId = await newSurvey('순서 지정 — 대표자 제외');
    await db
      .update(surveys)
      .set({
        contactColumns: orderedScheme(['실무자 e-mail'], ['대표자 e-mail', '실무자 e-mail']),
      })
      .where(eq(surveys.id, surveyId));
    const onlyCeo = await seedContact(surveyId, [['대표자 e-mail', 'only-ceo-dead@example.com']]);
    await seedBounce(surveyId, onlyCeo, 'only-ceo-dead@example.com');

    expect(await listBouncedContactIds(surveyId)).toEqual([]);
    expect(await selectEmailPiiRows(db, [onlyCeo], ['실무자 e-mail'])).toEqual([]);
  });

  it('테스트 파티션 컨택은 테스트 스킴의 순서를 따른다', async () => {
    const surveyId = await newSurvey('파티션별 순서');
    const keys = ['대표자 e-mail', '실무자 e-mail'];
    await db
      .update(surveys)
      .set({
        contactColumns: orderedScheme(['실무자 e-mail'], keys),
        testContactColumns: orderedScheme(['대표자 e-mail'], keys),
      })
      .where(eq(surveys.id, surveyId));
    const columns: Array<[string, string]> = [
      ['대표자 e-mail', 'part-ceo-dead@example.com'],
      ['실무자 e-mail', 'part-staff@example.com'],
    ];
    const real = await seedContact(surveyId, columns);
    const test = await seedContact(surveyId, columns);
    await db.update(contactTargets).set({ isTest: true }).where(eq(contactTargets.id, test));
    await seedBounce(surveyId, real, 'part-ceo-dead@example.com');

    // 실 파티션은 실무자 주소로 보내므로 대표자 주소 반송과 무관하고, 테스트 파티션은 대표자 주소로 보낸다.
    expect(await listBouncedContactIds(surveyId)).toEqual([test]);
    expect(real).toBeTruthy();
  });
});
