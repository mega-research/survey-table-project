import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  contactAttempts,
  contactPii,
  contactTargets,
  mailCampaigns,
  mailRecipients,
  surveyResponses,
  surveys,
} from '@/db/schema';
import { buildPiiRows } from '@/lib/crypto/contact-pii-repo';
import {
  listCampaignRecipients,
  previewCampaignCandidates,
} from '@/lib/operations/campaigns.server';
import { FILTER_NONE_VALUE } from '@/lib/operations/filter-shared';
import { parseHeaderFiltersFromUrl } from '@/lib/operations/contacts-filters.server';

const run = process.env['RUN_REALDB'] === '1' ? describe : describe.skip;

/**
 * 실 PostgreSQL 왕복 — mock 이 구조적으로 못 잡는 것을 잡는다.
 *
 * 깔때기 조건은 contact_targets 에 상관된 서브쿼리를 where 에 넣는다. 조인 집합이
 * 어긋나면 PG 가 missing FROM-clause entry 로 거절하는데, drizzle 체인을 mock 하면
 * 조인이 no-op 이라 그 오류가 드러나지 않는다 (실제로 통과시킨 적이 있다).
 */
run('캠페인 필터 실 DB 왕복', () => {
  const surveyId = randomUUID();

  afterAll(async () => {
    await db.delete(surveys).where(eq(surveys.id, surveyId));
  });

  it('그룹·최근 결과코드·메모 깔때기가 실제 PG 에서 실행된다 (count 포함)', async () => {
    const campaignId = randomUUID();
    const targetA = randomUUID();
    const targetB = randomUUID();

    await db.insert(surveys).values({ id: surveyId, title: '캠페인 필터 실DB 테스트' });
    await db.insert(contactTargets).values([
      { id: targetA, surveyId, resid: 1, inviteCode: randomUUID(), groupValue: '모바일' },
      { id: targetB, surveyId, resid: 2, inviteCode: randomUUID(), groupValue: null },
    ]);
    await db.insert(contactAttempts).values({
      id: randomUUID(),
      contactTargetId: targetA,
      attemptNo: 1,
      resultCode: '1.조사완료',
    });
    await db.insert(mailCampaigns).values({
      id: campaignId,
      surveyId,
      runNumber: 1,
      title: '필터 테스트',
      subjectSnapshot: '제목',
      bodyHtmlSnapshot: '<p>본문</p>',
      fromLocalSnapshot: 'survey',
      fromNameSnapshot: '조사',
    });
    await db.insert(mailRecipients).values([
      {
        id: randomUUID(),
        campaignId,
        contactTargetId: targetA,
        emailSnapshot: 'a@example.com',
        inviteTokenSnapshot: randomUUID(),
        status: 'bounced',
        errorReason: 'hard bounce',
      },
      {
        id: randomUUID(),
        campaignId,
        contactTargetId: targetB,
        emailSnapshot: 'b@example.com',
        inviteTokenSnapshot: randomUUID(),
        status: 'delivered',
      },
    ]);

    const base = { surveyId, campaignId, scope: 'real' as const };

    const byGroup = await listCampaignRecipients({ ...base, groupValues: ['모바일'] });
    expect(byGroup.total).toBe(1);
    expect(byGroup.rows.map((r) => r.contactResid)).toEqual([1]);

    const byEmptyGroup = await listCampaignRecipients({
      ...base,
      groupValues: [FILTER_NONE_VALUE],
    });
    expect(byEmptyGroup.total).toBe(1);
    expect(byEmptyGroup.rows.map((r) => r.contactResid)).toEqual([2]);

    const byResult = await listCampaignRecipients({ ...base, resultCodes: ['1.조사완료'] });
    expect(byResult.total).toBe(1);
    expect(byResult.rows[0]?.latestResultCode).toBe('1.조사완료');

    const byEmptyResult = await listCampaignRecipients({
      ...base,
      resultCodes: [FILTER_NONE_VALUE],
    });
    expect(byEmptyResult.total).toBe(1);
    expect(byEmptyResult.rows.map((r) => r.contactResid)).toEqual([2]);

    const byError = await listCampaignRecipients({ ...base, errorReasons: ['hard bounce'] });
    expect(byError.total).toBe(1);
    expect(byError.rows.map((r) => r.contactResid)).toEqual([1]);
  });

  // 마법사 미리보기의 "응답" 컬럼은 필터와 같은 축을 보여줘야 한다.
  // respondedAt 이진 표시는 완료 시각이 없는 진행중·이탈을 전부 "미응답" 으로 뭉갠다.
  it('미리보기 후보는 필터와 같은 응답 상태를 돌려준다', async () => {
    const targetC = randomUUID();
    await db.insert(contactTargets).values({
      id: targetC,
      surveyId,
      resid: 3,
      inviteCode: randomUUID(),
    });
    // 후보 조회는 이메일 PII 보유를 요구한다 (발송 불가 대상 자동 제외).
    await db.insert(contactPii).values(
      buildPiiRows(targetC, [{ columnKey: 'email', fieldType: 'email', plain: 'c@example.com' }]),
    );
    await db.insert(surveyResponses).values({
      id: randomUUID(),
      surveyId,
      contactTargetId: targetC,
      sessionId: randomUUID(),
      status: 'in_progress',
      questionResponses: {},
    });

    const clauses = parseHeaderFiltersFromUrl(
      ['system.web'],
      ['in'],
      ['in_progress'],
      [{ source: 'system.web', label: '응답' }],
      [],
    );

    const result = await previewCampaignCandidates({
      surveyId,
      scope: 'real',
      clauses,
      unrespondedOnly: false,
      page: 1,
      pageSize: 20,
    });

    expect(result.rows.map((r) => r.resid)).toEqual([3]);
    // 필터가 in_progress 로 골랐으면 표에 그릴 값도 in_progress 여야 한다.
    expect(result.rows[0]?.responseStatus).toBe('in_progress');
  });
});
