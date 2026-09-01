import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { isValidUUID } from '@/lib/utils';

import {
  classifyInviteTokenOwner,
  findInviteTokenOwner,
} from './invite-token-owner';

/**
 * inviteToken 으로 컨택 lookup. 반환 케이스 3가지:
 * - valid: 정상 ct, contactTargetId 매칭됨 (+ respondedAt/isTest 동봉)
 * - invalid_test: 테스트 대상자지만 테스트 모드 OFF [익명 폴백 금지]
 * - invalid: 토큰 자체가 무효 [익명 폴백]
 *
 * 수신거부(unsubscribed_at)·부정 결과코드는 여기서 보지 않는다 (2026-09-01 결정) —
 * 수신거부는 메일 채널 해지일 뿐 응답 자격이 아니고, 초대 링크로는 어떤 경우에도 응답할
 * 수 있어야 한다. 단체 메일 제외·응답률 모수 제외는 각자의 경로(캠페인 preflight·진척 집계)가
 * 계속 담당한다.
 *
 * mutation 흐름에서 호출되므로 dedupe 가 의미 없어 cache 적용 안 함.
 *
 * SECURITY DEFINER PG 함수 사용 — connection role 이 anon/authenticated 라도
 * RLS 우회해서 contact_target_id 만 안전하게 조회 가능. 다른 attrs/PII 는 노출 안 됨.
 *
 *
 * 원위치: src/actions/response-actions.ts — oRPC 마이그레이션에서 features service 와
 * lib/duplicate-detection(checkTrackA) 양쪽이 공유하므로 lib 로 승격.
 */
export type InviteTokenLookupResult =
  | { kind: 'valid'; contactTargetId: string; respondedAt: Date | null; isTest: boolean }
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
  const resolvedContactTargetId = lookup[0]?.id ?? null;

  // DB 함수는 survey_id를 함수 내부에서 제한하므로 교차 설문 token이면 null이다.
  // server-only 직접 조회로 owner 종류만 복원해 테스트 링크의 익명 강등을 막는다.
  const classification = classifyInviteTokenOwner(
    await findInviteTokenOwner(inviteToken),
    surveyId,
  );
  if (classification.kind !== 'valid') return classification;

  const { owner } = classification;
  if (resolvedContactTargetId && resolvedContactTargetId !== owner.id) {
    return owner.isTest ? { kind: 'invalid_test' } : { kind: 'invalid' };
  }
  const contactTargetId = resolvedContactTargetId ?? owner.id;

  if (owner.isTest) {
    return {
      kind: 'valid',
      contactTargetId,
      respondedAt: owner.respondedAt,
      isTest: true,
    };
  }


  return {
    kind: 'valid',
    contactTargetId,
    respondedAt: owner.respondedAt,
    isTest: false,
  };
}
