'use server';

import { eq, and } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';

/**
 * inviteToken 으로 attrs 조회. 무효 토큰이면 null 반환 (silent fallback).
 * - lookup_contact_by_invite_token RPC 와 동일한 매칭 정책 (surveyId + inviteToken)
 * - 응답 도중 새로고침 시 매번 fresh 로드 — 운영자가 attrs 수정하면 다음 진입에 반영
 */
export async function lookupContactAttrs(
  surveyId: string,
  inviteToken: string,
): Promise<Record<string, string> | null> {
  if (!inviteToken) return null;

  const [row] = await db
    .select({ attrs: contactTargets.attrs })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.inviteToken, inviteToken),
      ),
    )
    .limit(1);

  return row?.attrs ?? null;
}
