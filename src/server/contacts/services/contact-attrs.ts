import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
import { collectReferencedContactKeys } from '@/lib/contacts/respondent-pii';
import { appendContactPii } from '@/server/read-models/respondent-contact-attrs';
import { loadCurrentVersionSnapshot } from '@/server/read-models/version-snapshot';
import {
  classifyInviteTokenOwner,
  findInviteTokenOwner,
} from '@/server/read-models/invite-token-owner';
import { isValidUUID } from '@/lib/utils';

import type {
  ContactAttrsOutput,
  LookupContactAttrsInput,
} from '../domain/contact-attrs';

export class InvalidTestLinkError extends Error {
  readonly code = 'INVALID_TEST_LINK' as const;

  constructor() {
    super('테스트 링크가 비활성 상태입니다.');
    this.name = 'InvalidTestLinkError';
  }
}

/**
 * inviteToken 으로 attrs 조회. 무효 토큰이면 null 반환 (silent fallback).
 * 개인정보 열 중 발행본이 읽는 것의 복호화 값도 합쳐서 돌려준다(read-models/respondent-contact-attrs).
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
      id: contactTargets.id,
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
  // 개인정보로 암호화된 열도 합친다 — 단 응답자 브라우저로 가는 값이라 발행본이 토큰·조건으로
  // 실제로 읽는 열만 보낸다. 쓰지도 않는 남의 연락처가 초대 링크로 새어 나가면 안 된다.
  return appendContactPii(row, {
    allowedKeys: async () => collectReferencedContactKeys(await loadCurrentVersionSnapshot(surveyId)),
  });
}
