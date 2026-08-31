import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { contactPriorAnswers, contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
import { normalizePriorAnswers } from '@/lib/survey/prior-answers';
import { isValidUUID } from '@/lib/utils';

import type {
  LookupPriorAnswersInput,
  PriorAnswersOutput,
} from '../../domain/prior-answers';

/**
 * inviteToken 으로 이월 응답 조회. 매칭 실패·이월 응답 없음이면 null.
 *
 * 무효 테스트 링크를 여기서 throw 하지 않는다 — 그 게이트는 같은 진입에서
 * 함께 호출되는 attrs lookup 이 소유하고, 이쪽은 데이터만 fail-closed(null) 한다.
 * 두 곳에서 던지면 같은 원인으로 오류가 두 번 나 화면 판정이 흔들린다.
 *
 * 실/테스트 파티션 축을 따로 두지 않는다 — 이월 응답은 조사 대상에 붙으므로
 * 조사 대상의 파티션을 그대로 따르고, 테스트 모드가 꺼진 테스트 대상은 비운다.
 *
 * 인증 불필요(pub). 읽기 전용이라 revalidatePath 없음.
 */
export async function lookupPriorAnswers(
  input: LookupPriorAnswersInput,
): Promise<PriorAnswersOutput> {
  const { surveyId, inviteToken } = input;

  if (!inviteToken || !isValidUUID(inviteToken) || !isValidUUID(surveyId)) return null;

  const [row] = await db
    .select({
      answers: contactPriorAnswers.answers,
      isTest: contactTargets.isTest,
      testModeEnabled: surveys.testModeEnabled,
    })
    .from(contactPriorAnswers)
    .innerJoin(contactTargets, eq(contactPriorAnswers.contactTargetId, contactTargets.id))
    .innerJoin(surveys, eq(contactTargets.surveyId, surveys.id))
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.inviteToken, inviteToken),
        isNull(surveys.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (row.isTest && !row.testModeEnabled) return null;

  const answers = normalizePriorAnswers(row.answers);
  return Object.keys(answers).length > 0 ? answers : null;
}
