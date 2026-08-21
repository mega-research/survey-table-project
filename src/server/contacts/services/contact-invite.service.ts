import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
import { getSurveyAccessIdentifier } from '@/lib/survey-url';

export type ResolvedInvite =
  | { kind: 'valid'; accessIdentifier: string; inviteToken: string }
  | { kind: 'invalid_test' };

/**
 * /i/{code} 라우트용 — inviteCode 로 (accessIdentifier, inviteToken) 역참조.
 * 미존재 코드/삭제된 설문은 null. 테스트 대상자는 설문 테스트 모드가 OFF면
 * invalid_test로 종료하고, 실제 대상자는 테스트 모드와 무관하게 기존 링크를 유지한다.
 * unsubscribe·dedupe 판정은 기존 응답 저장 단계(inviteToken 기준)에 위임한다.
 */
export async function resolveInviteCode(code: string): Promise<ResolvedInvite | null> {
  if (!code) return null;

  const [row] = await db
    .select({
      surveyId: surveys.id,
      slug: surveys.slug,
      privateToken: surveys.privateToken,
      isPublic: surveys.isPublic,
      inviteToken: contactTargets.inviteToken,
      isTest: contactTargets.isTest,
      testModeEnabled: surveys.testModeEnabled,
    })
    .from(contactTargets)
    .innerJoin(surveys, eq(contactTargets.surveyId, surveys.id))
    .where(and(eq(contactTargets.inviteCode, code), isNull(surveys.deletedAt)))
    .limit(1);

  if (!row) return null;
  if (row.isTest && !row.testModeEnabled) return { kind: 'invalid_test' };

  const accessIdentifier = getSurveyAccessIdentifier({
    id: row.surveyId,
    slug: row.slug,
    privateToken: row.privateToken,
    isPublic: row.isPublic,
  });

  return { kind: 'valid', accessIdentifier, inviteToken: row.inviteToken };
}
