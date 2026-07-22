import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema';
import {
  buildNegativeCodeExists,
  getResultCodeStatuses,
} from '@/lib/operations/result-code-statuses.server';
import { isValidUUID } from '@/lib/utils';

/**
 * inviteToken 으로 컨택 lookup. 반환 케이스 4가지:
 * - valid: 정상 ct, contactTargetId 매칭됨 (+ respondedAt/isTest 동봉)
 * - excluded: 부정 결과코드 OR unsubscribed_at IS NOT NULL [응답 차단]
 * - invalid_test: 테스트 대상자지만 테스트 모드 OFF [익명 폴백 금지]
 * - invalid: 토큰 자체가 무효 [익명 폴백]
 *
 * mutation 흐름에서 호출되므로 dedupe 가 의미 없어 cache 적용 안 함.
 *
 * SECURITY DEFINER PG 함수 사용 — connection role 이 anon/authenticated 라도
 * RLS 우회해서 contact_target_id 만 안전하게 조회 가능. 다른 attrs/PII 는 노출 안 됨.
 *
 * SECURITY: 차단 사유는 호출자에게 구분 노출하지 않음 [UI 는 동일 카피 — PII].
 *
 * 원위치: src/actions/response-actions.ts — oRPC 마이그레이션에서 features service 와
 * lib/duplicate-detection(checkTrackA) 양쪽이 공유하므로 lib 로 승격.
 */
export type InviteTokenLookupResult =
  | { kind: 'valid'; contactTargetId: string; respondedAt: Date | null; isTest: boolean }
  | { kind: 'excluded' }
  | { kind: 'invalid_test' }
  | { kind: 'invalid' };

export async function findContactByInviteToken(
  surveyId: string,
  inviteToken: string,
): Promise<InviteTokenLookupResult> {
  // inviteToken 은 URL searchParams 에서 온 임의 문자열 (bot probe·잘린 링크 등).
  // UUID 형식이 아니면 ${inviteToken}::uuid 캐스트가 PG 22P02 로 throw 하므로,
  // 캐스트 전에 형식 검증해 invalid 로 폴백한다 (익명 amber-alert 흐름).
  if (!isValidUUID(inviteToken)) return { kind: 'invalid' };

  const lookup = (await db.execute(
    sql`SELECT public.lookup_contact_by_invite_token(${surveyId}::uuid, ${inviteToken}::uuid) AS id`,
  )) as unknown as Array<{ id: string | null }>;
  const contactTargetId = lookup[0]?.id ?? null;
  if (!contactTargetId) return { kind: 'invalid' };

  // SECURITY DEFINER 함수가 반환한 대상의 소속 surveyId와 isTest를 먼저 보존한다.
  // 교차 설문 토큰이라도 테스트 대상자면 invalid_test로 종류를 유지해
  // 선택 초대 설문의 익명 폴백을 닫고, 실제 대상자는 기존 invalid 계약을 유지한다.
  const row = await db.query.contactTargets.findFirst({
    where: eq(contactTargets.id, contactTargetId),
    columns: { surveyId: true, respondedAt: true, isTest: true },
    with: {
      survey: {
        columns: { testModeEnabled: true, deletedAt: true },
      },
    },
  });
  if (!row) return { kind: 'invalid' };
  if (row.surveyId !== surveyId) {
    return row.isTest ? { kind: 'invalid_test' } : { kind: 'invalid' };
  }
  if (row.survey.deletedAt) {
    return row.isTest ? { kind: 'invalid_test' } : { kind: 'invalid' };
  }
  if (row.isTest) {
    if (!row.survey.testModeEnabled) return { kind: 'invalid_test' };
    return {
      kind: 'valid',
      contactTargetId,
      respondedAt: row.respondedAt,
      isTest: true,
    };
  }

  const { negative: negativeCodes } = await getResultCodeStatuses(surveyId);
  const excludedRows = (await db.execute(sql`
    SELECT 1
    FROM contact_targets ct
    WHERE ct.id = ${contactTargetId}::uuid
      AND (
        ct.unsubscribed_at IS NOT NULL
        ${negativeCodes.length > 0
          ? sql`OR ${buildNegativeCodeExists(negativeCodes, sql`ct.id`)}`
          : sql``}
      )
    LIMIT 1
  `)) as unknown as unknown[];
  if (excludedRows.length > 0) {
    return { kind: 'excluded' };
  }

  return { kind: 'valid', contactTargetId, respondedAt: row.respondedAt, isTest: false };
}
