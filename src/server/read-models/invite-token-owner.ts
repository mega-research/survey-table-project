import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema';
import { isValidUUID } from '@/lib/utils';

/** invite token의 소유 종류를 판정하는 데 필요한 비개인정보 최소 필드. */
export type InviteTokenOwner = {
  id: string;
  surveyId: string;
  isTest: boolean;
  respondedAt: Date | null;
  survey: {
    testModeEnabled: boolean;
    deletedAt: Date | null;
  };
};

export type InviteTokenOwnerClassification =
  | { kind: 'valid'; owner: InviteTokenOwner }
  | { kind: 'invalid_test' }
  | { kind: 'invalid' };

/**
 * 요청 survey 조건을 걸기 전에 token owner 종류를 보존한다.
 * attrs 등 개인정보 컬럼은 투영하지 않는다.
 */
export async function findInviteTokenOwner(
  inviteToken: string,
): Promise<InviteTokenOwner | null> {
  if (!isValidUUID(inviteToken)) return null;

  const owner = await db.query.contactTargets.findFirst({
    where: eq(contactTargets.inviteToken, inviteToken),
    columns: {
      id: true,
      surveyId: true,
      isTest: true,
      respondedAt: true,
    },
    with: {
      survey: {
        columns: {
          testModeEnabled: true,
          deletedAt: true,
        },
      },
    },
  });

  return owner ?? null;
}

/** 테스트 owner는 교차 설문·삭제 설문·모드 OFF 모두 fail-closed 한다. */
export function classifyInviteTokenOwner(
  owner: InviteTokenOwner | null,
  requestedSurveyId: string,
): InviteTokenOwnerClassification {
  if (!owner) return { kind: 'invalid' };

  if (owner.surveyId !== requestedSurveyId || owner.survey.deletedAt) {
    return owner.isTest ? { kind: 'invalid_test' } : { kind: 'invalid' };
  }

  if (owner.isTest && !owner.survey.testModeEnabled) {
    return { kind: 'invalid_test' };
  }

  return { kind: 'valid', owner };
}
