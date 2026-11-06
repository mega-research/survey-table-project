import 'server-only';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactPriorAnswers, contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
import { isValidUUID } from '@/lib/utils';
import { readPriorAnswerRow } from '@/server/read-models/contact-prior-answers';

import type {
  LookupPriorAnswersInput,
  PriorAnswersOutput,
} from '../domain/prior-answers';

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

  return readPriorAnswerRow(row.answers);
}



/**
 * 조사 대상 id 목록의 이월 응답을 한 번에 읽는다 — Raw 내보내기 「이월 응답 포함」 전용.
 *
 * 읽기 경계(복호화·파기 표식 제거)는 단건 조회와 같은 `readPriorAnswerRow` 다. 파티션은
 * 호출부가 이미 스코프로 거른 조사 대상 id 를 넘기므로 여기서 다시 판정하지 않는다.
 * 이월이 없거나 전부 파기된 대상은 맵에 없다.
 */
export async function loadPriorAnswersByContactTargets(
  contactTargetIds: readonly string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (contactTargetIds.length === 0) return out;
  const rows = await db
    .select({
      contactTargetId: contactPriorAnswers.contactTargetId,
      answers: contactPriorAnswers.answers,
    })
    .from(contactPriorAnswers)
    .where(inArray(contactPriorAnswers.contactTargetId, [...contactTargetIds]));
  for (const row of rows) {
    const answers = readPriorAnswerRow(row.answers);
    if (answers) out.set(row.contactTargetId, answers);
  }
  return out;
}

/**
 * 이 설문에서 변동 확인이 붙는 문항 id 집합.
 *
 * 내보내기가 "변동 확인 변수를 만들 문항"을 정하는 근거다. 응답에 남은 확인 기록이
 * 아니라 **이월 응답의 문항 키**에서 모은다 — 응답 쪽을 보면 필터·진행 상황에 따라
 * 같은 설문의 두 내보내기가 서로 다른 변수 집합을 내게 된다.
 *
 * 값이 비어 있는 키는 제외한다. 응답 화면은 `hasPriorAnswer` 로 판정해 빈 값에는
 * 컨트롤을 띄우지 않으므로, 키만 보고 변수를 만들면 아무도 답할 수 없는 유령 변수가
 * 남는다(191문항 rawdata 에서 빈 셀은 흔하다). SQL 의 빈 판정은 최상위 값만 보는
 * 근사라 화면 판정보다 느슨하다 — 중첩이 전부 비어 있는 객체/배열은 통과한다.
 *
 * 값을 읽지 않고 키만 모으므로 PII 복호화가 필요 없다.
 *
 * 실/테스트 파티션은 조사 대상을 따른다 — 내보내기가 보는 파티션과 같은 값을 넘긴다.
 */
export async function loadChangeConfirmQuestionIds(
  surveyId: string,
  options: { isTest: boolean },
): Promise<Set<string>> {
  if (!isValidUUID(surveyId)) return new Set();

  const rows = await db.execute<{ question_id: string | null }>(sql`
    SELECT DISTINCT entry.key AS question_id
    FROM contact_prior_answers cpa
    JOIN contact_targets ct ON ct.id = cpa.contact_target_id
    CROSS JOIN LATERAL jsonb_each(cpa.answers) AS entry(key, value)
    WHERE ct.survey_id = ${surveyId}::uuid
      AND ct.is_test = ${options.isTest}
      -- 문항별 변동 확인이 꺼진 설문은 확인 자체를 받지 않으므로 변수도 만들지 않는다.
      -- 응답 화면의 노출 규칙과 내보내기 변수 생성이 갈라지면, 컨트롤이 없는 문항에만
      -- 변수가 생겨 전 칸 결측인 열이 나간다.
      AND EXISTS (
        SELECT 1 FROM surveys s
        WHERE s.id = ct.survey_id AND s.change_confirm_enabled
      )
      AND jsonb_typeof(cpa.answers) = 'object'
      -- 사이드카 키(밑줄 두 개 접두)는 문항이 아니다.
      AND left(entry.key, 2) <> '__'
      AND jsonb_typeof(entry.value) <> 'null'
      AND entry.value <> '""'::jsonb
      AND entry.value <> '[]'::jsonb
      AND entry.value <> '{}'::jsonb
  `);

  const ids = new Set<string>();
  for (const row of rows) {
    if (row.question_id) ids.add(row.question_id);
  }
  return ids;
}
