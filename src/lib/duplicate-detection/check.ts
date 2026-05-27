import { and, eq, isNull, isNotNull, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses } from '@/db/schema/surveys';
import { findContactByInviteToken } from '@/actions/response-actions';
import type { CheckResult, ServerSignals } from './types';

export async function checkTrackA(
  surveyId: string,
  inviteToken: string,
): Promise<CheckResult> {
  const contact = await findContactByInviteToken(surveyId, inviteToken);
  if (!contact) return { blocked: true, reason: 'invalid_token' };
  if (contact.respondedAt) {
    return { blocked: true, reason: 'token_already_used' };
  }
  return { blocked: false, contactTargetId: contact.id };
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
      isNull(surveyResponses.deletedAt),
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
