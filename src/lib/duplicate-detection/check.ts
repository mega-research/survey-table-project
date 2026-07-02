import { and, eq, isNull, isNotNull, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema/surveys';
import { notDeletedResponse, notTestResponse } from '@/data/response-filters';
import { findContactByInviteToken } from './invite-lookup';
import type { CheckResult, ServerSignals } from './types';

export async function checkTrackA(
  surveyId: string,
  inviteToken: string,
): Promise<CheckResult> {
  const lookup = await findContactByInviteToken(surveyId, inviteToken);
  // excluded = 부정 결과코드 OR unsubscribed → 응답 모수 제외 카드로 안내
  // invalid = 토큰 자체가 없거나 형식 오류 → 무효 토큰 카드
  if (lookup.kind === 'excluded') {
    return { blocked: true, reason: 'excluded_from_population' };
  }
  if (lookup.kind === 'invalid') {
    return { blocked: true, reason: 'invalid_token' };
  }
  if (lookup.respondedAt) {
    return { blocked: true, reason: 'token_already_used' };
  }
  return { blocked: false, contactTargetId: lookup.contactTargetId };
}

export async function checkTrackB(params: {
  surveyId: string;
  signals: ServerSignals;
}): Promise<CheckResult> {
  const { surveyId, signals } = params;

  // 조건 1: deviceId 단독 일치 (둘 다 NULL 아님)
  const cond1 = signals.deviceId
    ? eq(surveyResponses.deviceId, signals.deviceId)
    : sql`false`;

  // signals.deviceId == null 이면 row 측 deviceId 무관 (sql`true`)
  // signals.deviceId 값이 있으면 row.deviceId가 NULL이거나 같은 값일 때만 매칭
  const deviceConstraint = signals.deviceId == null
    ? sql`true`
    : or(
        isNull(surveyResponses.deviceId),
        eq(surveyResponses.deviceId, signals.deviceId),
      );

  // 조건 2: fp + ip 둘 다 일치 + deviceConstraint
  const cond2 = and(
    signals.fpHash ? eq(surveyResponses.fpHash, signals.fpHash) : sql`false`,
    signals.ipHash ? eq(surveyResponses.ipHash, signals.ipHash) : sql`false`,
    deviceConstraint,
  );

  const existing = await db.query.surveyResponses.findFirst({
    where: and(
      eq(surveyResponses.surveyId, surveyId),
      notDeletedResponse,
      notTestResponse,
      isNotNull(surveyResponses.completedAt),
      or(cond1, cond2),
    ),
    columns: { id: true },
  });

  if (existing) {
    return { blocked: true, reason: 'device_already_responded' };
  }
  return { blocked: false };
}
