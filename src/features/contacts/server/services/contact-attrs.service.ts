import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { loadOperationsDataScope, testFlagForScope } from '@/lib/operations/data-scope.server';
import { isValidUUID } from '@/lib/utils';

import type {
  ContactAttrsOutput,
  LookupContactAttrsInput,
} from '../../domain/contact-attrs';

/**
 * inviteToken 으로 attrs 조회. 무효 토큰이면 null 반환 (silent fallback).
 * - lookup_contact_by_invite_token RPC 와 동일한 매칭 정책 (surveyId + inviteToken)
 * - 응답 도중 새로고침 시 매번 fresh 로드 — 운영자가 attrs 수정하면 다음 진입에 반영
 *
 * 비-UUID inviteToken 은 throw 하지 않고 null 로 흡수한다.
 * 호출부가 amber alert + 익명 폴백을 하는 fail-open UX 를 보존하기 위함이며,
 * malformed uuid 가 Postgres 캐스트 에러를 내는 것도 함께 차단한다.
 *
 * 인증 불필요(pub). 읽기 전용이라 revalidatePath 없음.
 */
export async function lookupContactAttrs(
  input: LookupContactAttrsInput,
): Promise<ContactAttrsOutput> {
  const { surveyId, inviteToken } = input;

  if (!inviteToken || !isValidUUID(inviteToken)) return null;

  // 공개 응답 진입도 운영 콘솔의 현재 스코프를 따른다. 모드 전환 뒤 이전 링크로
  // 반대 스코프 attrs 가 노출되는 것을 막되, 무효 토큰과 동일하게 익명 폴백한다.
  const scope = await loadOperationsDataScope(surveyId);

  const [row] = await db
    .select({ attrs: contactTargets.attrs })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.inviteToken, inviteToken),
        eq(contactTargets.isTest, testFlagForScope(scope)),
      ),
    )
    .limit(1);

  return row?.attrs ?? null;
}
