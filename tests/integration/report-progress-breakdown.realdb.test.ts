/**
 * 제외 사유 내역 — 실DB 왕복 계약 테스트.
 *
 * 계약: 사유 버킷(자격 미달 / 결과코드 부적격 / 수신거부)은 서로 겹치지 않으며
 * 셋의 합이 excludedTotal 과 정확히 같다. 한 컨택이 여러 사유에 해당해도 한 번만 센다.
 *
 * 이 계약은 SQL 의 NOT/AND 결합 순서에 달려 있어 JS 시뮬레이터 모킹으로는 검증되지
 * 않는다 (report-progress-exclusion.test.ts 는 시뮬레이터라 이 부분을 못 본다).
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요)
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { surveys, surveyResponses, contactTargets, contactAttempts } from '@/db/schema';
import { getProgressTotals } from '@/server/operations/services/report-progress.server';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];

async function seedSurvey(): Promise<string> {
  const [row] = await db
    .insert(surveys)
    .values({
      title: '제외 내역 테스트',
      status: 'published',
      contactResultCodes: [
        { code: '1.조사완료', label: '1.조사완료', order: 1, status: 'positive' },
        { code: '9.조사 대상 아님', label: '9.조사 대상 아님', order: 9, status: 'negative' },
      ],
    })
    .returning({ id: surveys.id });
  if (!row) throw new Error('설문 시드 실패');
  createdSurveyIds.push(row.id);
  return row.id;
}

interface Seed {
  resid: number;
  negativeCode?: boolean;
  unsubscribed?: boolean;
  screenedOut?: boolean;
}

async function seedContacts(surveyId: string, seeds: Seed[]): Promise<void> {
  for (const s of seeds) {
    const [ct] = await db
      .insert(contactTargets)
      .values({
        surveyId,
        resid: s.resid,
        isTest: false,
        inviteCode: `bd-${surveyId.slice(0, 8)}-${s.resid}`,
        ...(s.unsubscribed ? { unsubscribedAt: new Date() } : {}),
      })
      .returning({ id: contactTargets.id });
    if (!ct) throw new Error('컨택 시드 실패');

    if (s.negativeCode) {
      await db
        .insert(contactAttempts)
        .values({ contactTargetId: ct.id, attemptNo: 1, resultCode: '9.조사 대상 아님' });
    }
    if (s.screenedOut) {
      await db.insert(surveyResponses).values({
        surveyId,
        contactTargetId: ct.id,
        sessionId: `sess-${surveyId}-${s.resid}`,
        questionResponses: {},
        status: 'screened_out',
        isCompleted: false,
        isTest: false,
      });
    }
  }
}

afterAll(async () => {
  if (createdSurveyIds.length > 0) {
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  }
});

describe.skipIf(!isLocalDb)('getProgressTotals — 제외 사유 내역', () => {
  it('사유가 겹치지 않는 경우 버킷 합이 제외 총계와 같다', async () => {
    const surveyId = await seedSurvey();
    await seedContacts(surveyId, [
      { resid: 1 },
      { resid: 2, screenedOut: true },
      { resid: 3, negativeCode: true },
      { resid: 4, unsubscribed: true },
    ]);

    const totals = await getProgressTotals(surveyId, 'real', null);

    expect(totals.excludedTotal).toBe(3);
    expect(totals.excludedScreenedOut).toBe(1);
    expect(totals.excludedNegativeCode).toBe(1);
    expect(totals.excludedUnsubscribed).toBe(1);
    expect(totals.listTotal).toBe(1);
  });

  it('한 컨택이 세 사유에 모두 해당해도 한 번만, 가장 구체적인 사유로 센다', async () => {
    const surveyId = await seedSurvey();
    await seedContacts(surveyId, [
      { resid: 1 },
      { resid: 2, screenedOut: true, negativeCode: true, unsubscribed: true },
    ]);

    const totals = await getProgressTotals(surveyId, 'real', null);

    expect(totals.excludedTotal).toBe(1);
    // 우선순위: 자격 미달 > 결과코드 부적격 > 수신거부
    expect(totals.excludedScreenedOut).toBe(1);
    expect(totals.excludedNegativeCode).toBe(0);
    expect(totals.excludedUnsubscribed).toBe(0);
    const sum =
      totals.excludedScreenedOut + totals.excludedNegativeCode + totals.excludedUnsubscribed;
    expect(sum).toBe(totals.excludedTotal);
  });

  it('결과코드 부적격과 수신거부가 겹치면 결과코드 쪽으로 센다', async () => {
    const surveyId = await seedSurvey();
    await seedContacts(surveyId, [{ resid: 1, negativeCode: true, unsubscribed: true }]);

    const totals = await getProgressTotals(surveyId, 'real', null);

    expect(totals.excludedTotal).toBe(1);
    expect(totals.excludedNegativeCode).toBe(1);
    expect(totals.excludedUnsubscribed).toBe(0);
  });

  it('반대 파티션(test)의 자격미달은 real 집계의 제외에 들어가지 않는다', async () => {
    const surveyId = await seedSurvey();
    await seedContacts(surveyId, [{ resid: 1 }]);
    const [ct] = await db
      .insert(contactTargets)
      .values({ surveyId, resid: 2, isTest: true, inviteCode: `bd-${surveyId.slice(0, 8)}-t2` })
      .returning({ id: contactTargets.id });
    await db.insert(surveyResponses).values({
      surveyId,
      contactTargetId: ct!.id,
      sessionId: `sess-${surveyId}-test`,
      questionResponses: {},
      status: 'screened_out',
      isCompleted: false,
      isTest: true,
    });

    const totals = await getProgressTotals(surveyId, 'real', null);

    expect(totals.excludedTotal).toBe(0);
    expect(totals.excludedScreenedOut).toBe(0);
  });
});

// 사용하지 않는 import 경고 방지용 참조 (eq 는 정리 쿼리에서만 쓰일 수 있음)
void eq;
