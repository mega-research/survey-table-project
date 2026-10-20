import 'server-only';

import { and, eq } from 'drizzle-orm';

import * as Sentry from '@sentry/nextjs';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { maskHint } from '@/lib/crypto/mask-hint';
import { UUID_RE } from '@/lib/mail/constants';
import { loadSendEmailForTarget } from '@/server/read-models/send-address';

import type {
  LookupContactByTokenInput,
  LookupContactByTokenOutput,
  RevertUnsubscribeByContactIdInput,
  RevertUnsubscribeByContactIdOutput,
} from '../domain/mail-unsubscribe';

/**
 * 토큰으로 contact 정보만 조회(mutation 없음).
 * GET 페이지(확인 화면)에서 사용. 인증 불필요(pub), revalidatePath 없음(읽기 전용).
 *
 * 비-UUID 토큰은 throw 하지 않고 ok=false 로 흡수 — 호출부의 친절한 fallback UX 보존.
 * DB 장애 등 예외도 swallow 하고 ok=false 로 응답한다.
 */
export async function lookupContactByToken(
  input: LookupContactByTokenInput,
): Promise<LookupContactByTokenOutput> {
  const { token } = input;

  if (!UUID_RE.test(token)) {
    return { ok: false, email: null, alreadyUnsubscribed: false };
  }
  try {
    const [existing] = await db
      .select({
        id: contactTargets.id,
        surveyId: contactTargets.surveyId,
        isTest: contactTargets.isTest,
        unsubscribedAt: contactTargets.unsubscribedAt,
      })
      .from(contactTargets)
      .where(eq(contactTargets.unsubscribeToken, token))
      .limit(1);

    if (!existing) {
      return { ok: false, email: null, alreadyUnsubscribed: false };
    }

    // 이메일은 마스킹/표시용으로만 사용. 한 컨택에 email 컬럼이 여러 개면 발송과 같은
    // 규칙으로 고른다 — 메일을 받은 주소가 화면에 보여야 한다.
    // 미인증(pub) 경로이므로 평문 이메일을 노출하지 않는다. 복호화 후 즉시 마스킹해
    // 표시용 힌트(asd...@nav...)만 반환한다. 소비처(unsubscribe page)는 화면 표시
    // 문자열로만 사용하므로 마스킹 값으로 충분하다.
    const plain = await loadSendEmailForTarget(existing);
    const email = plain ? maskHint('email', plain) || null : null;

    return {
      ok: true,
      email,
      alreadyUnsubscribed: existing.unsubscribedAt !== null,
    };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { operation: 'unsubscribe_lookup_by_token' },
      level: 'error',
    });
    return { ok: false, email: null, alreadyUnsubscribed: false };
  }
}

/**
 * 운영자(admin)가 단체 메일 페이지에서 직접 수신거부를 해제.
 *
 * 보안:
 *   - 인증은 authed 미들웨어가 담당(원본 requireAuth 대체).
 *   - surveyId scope 일치 검증 — 다른 설문의 컨택을 임의로 건드리지 못하게 차단.
 *
 * 멱등성: 이미 해제된 행이어도(매칭만 되면) ok 반환.
 * 캐시 무효화(revalidatePath)는 제거 — 소비처 버튼의 router.refresh 로 대체한다.
 */
export async function revertUnsubscribeByContactId(
  input: RevertUnsubscribeByContactIdInput,
): Promise<RevertUnsubscribeByContactIdOutput> {
  const { contactId, surveyId } = input;

  if (!UUID_RE.test(contactId) || !UUID_RE.test(surveyId)) {
    return { ok: false, error: '잘못된 요청입니다.' };
  }

  try {
    const updated = await db
      .update(contactTargets)
      .set({ unsubscribedAt: null })
      .where(
        and(
          eq(contactTargets.id, contactId),
          eq(contactTargets.surveyId, surveyId),
        ),
      )
      .returning({ surveyId: contactTargets.surveyId });

    const row = updated[0];
    if (!row) {
      return { ok: false, error: '대상 컨택을 찾을 수 없습니다.' };
    }
    return { ok: true };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { operation: 'admin_revert_unsubscribe' },
      extra: { contactId, surveyId },
      level: 'error',
    });
    return { ok: false, error: '해제 처리 중 오류가 발생했습니다.' };
  }
}
