import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
import {
  classifyInviteTokenOwner,
  findInviteTokenOwner,
} from '@/lib/duplicate-detection/invite-token-owner';
import { isValidUUID } from '@/lib/utils';

import type {
  ContactAttrsOutput,
  LookupContactAttrsInput,
} from '../../domain/contact-attrs';

export class InvalidTestLinkError extends Error {
  readonly code = 'INVALID_TEST_LINK' as const;

  constructor() {
    super('테스트 링크가 비활성 상태입니다.');
    this.name = 'InvalidTestLinkError';
  }
}

/**
 * inviteToken 으로 attrs 조회. 무효 토큰이면 null 반환 (silent fallback).
 * - lookup_contact_by_invite_token RPC 와 동일한 매칭 정책 (surveyId + inviteToken)
 * - 응답 도중 새로고침 시 매번 fresh 로드 — 운영자가 attrs 수정하면 다음 진입에 반영
 * - 실제 대상자는 테스트 모드와 무관하게 조회, OFF인 테스트 대상자는 INVALID_TEST_LINK
 *
 * 비-UUID inviteToken 은 throw 하지 않고 null 로 흡수한다.
 * 일반 무효 토큰의 amber alert + 익명 폴백 UX를 보존하면서 malformed uuid의
 * Postgres 캐스트 오류를 차단한다. 테스트 대상자만 모드 OFF 시 fail-closed 한다.
 *
 * 인증 불필요(pub). 읽기 전용이라 revalidatePath 없음.
 */
export async function lookupContactAttrs(
  input: LookupContactAttrsInput,
): Promise<ContactAttrsOutput> {
  const { surveyId, inviteToken } = input;

  if (!inviteToken || !isValidUUID(inviteToken)) return null;

  const ownerClassification = classifyInviteTokenOwner(
    await findInviteTokenOwner(inviteToken),
    surveyId,
  );
  if (ownerClassification.kind === 'invalid_test') {
    throw new InvalidTestLinkError();
  }
  if (ownerClassification.kind === 'invalid') return null;

  const [row] = await db
    .select({
      attrs: contactTargets.attrs,
      isTest: contactTargets.isTest,
      testModeEnabled: surveys.testModeEnabled,
    })
    .from(contactTargets)
    .innerJoin(surveys, eq(contactTargets.surveyId, surveys.id))
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.inviteToken, inviteToken),
        isNull(surveys.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    if (ownerClassification.owner.isTest) throw new InvalidTestLinkError();
    return null;
  }
  if (row.isTest && !row.testModeEnabled) throw new InvalidTestLinkError();
  return row.attrs;
}
