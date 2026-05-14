'use server';

import { and, asc, eq, type SQL } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import * as Sentry from '@sentry/nextjs';

import { db } from '@/db';
import { contactPii, contactTargets } from '@/db/schema/contacts';
import { requireAuth } from '@/lib/auth';
import { decryptPii } from '@/lib/crypto/aes';
import { UUID_RE } from '@/lib/mail/constants';

export interface UnsubscribeResult {
  ok: boolean;
  email: string | null;
  alreadyUnsubscribed: boolean;
}

/**
 * 캠페인 페이지(목록 + 상세 [cid]) 캐시 즉시 무효화.
 * admin 이 다른 탭에서 보고 있을 때 새로고침 없이 badge/카운터 반영.
 */
function revalidateCampaignsForSurvey(surveyId: string): void {
  revalidatePath(
    `/admin/surveys/${surveyId}/operations/mail/campaigns`,
    'layout',
  );
}

/**
 * unsubscribed_at = NULL 로 되돌리고 캠페인 페이지 캐시 무효화.
 * where 절로 admin(id+surveyId) / form action(token) 두 호출자 공유.
 * 매칭 행이 없으면 null 반환 — 호출자가 에러 처리 또는 silent 통과 결정.
 */
async function clearUnsubscribed(where: SQL): Promise<{ surveyId: string } | null> {
  const updated = await db
    .update(contactTargets)
    .set({ unsubscribedAt: null })
    .where(where)
    .returning({ surveyId: contactTargets.surveyId });
  const row = updated[0];
  if (!row) return null;
  revalidateCampaignsForSurvey(row.surveyId);
  return row;
}

/**
 * 토큰으로 contact_targets 행을 찾아 unsubscribed_at 을 설정.
 * idempotent — 이미 해지된 row 는 추가 변경 없이 통과.
 * 페이지가 GET 시 호출하므로 link prefetch 가 사고를 일으켜도 영향 무해.
 *
 * DB 장애 등 예외는 swallow 하고 `ok: false` 로 응답 — 페이지가 친절한 fallback 표시.
 */
export async function unsubscribeByToken(token: string): Promise<UnsubscribeResult> {
  if (!UUID_RE.test(token)) {
    return { ok: false, email: null, alreadyUnsubscribed: false };
  }

  try {
    // contact_targets + contact_pii(email) LEFT JOIN — 이메일은 마스킹/표시용으로만 사용.
    // 한 컨택에 email 컬럼이 여러 개면 column_key 알파벳 순 첫 번째.
    const rows = await db
      .select({
        id: contactTargets.id,
        surveyId: contactTargets.surveyId,
        unsubscribedAt: contactTargets.unsubscribedAt,
        cipher: contactPii.cipher,
        columnKey: contactPii.columnKey,
      })
      .from(contactTargets)
      .leftJoin(
        contactPii,
        and(
          eq(contactPii.contactTargetId, contactTargets.id),
          eq(contactPii.fieldType, 'email'),
        ),
      )
      .where(eq(contactTargets.unsubscribeToken, token))
      .orderBy(asc(contactPii.columnKey))
      .limit(1);

    const existing = rows[0];
    if (!existing) {
      return { ok: false, email: null, alreadyUnsubscribed: false };
    }

    let email: string | null = null;
    if (existing.cipher) {
      try {
        email = decryptPii(existing.cipher);
      } catch {
        // 복호화 실패 시 email 노출 안 함 — 페이지가 이메일 없는 fallback 메시지 표시.
      }
    }

    const alreadyUnsubscribed = existing.unsubscribedAt !== null;
    if (!alreadyUnsubscribed) {
      await db
        .update(contactTargets)
        .set({ unsubscribedAt: new Date() })
        .where(eq(contactTargets.unsubscribeToken, token));
      revalidateCampaignsForSurvey(existing.surveyId);
    }
    return { ok: true, email, alreadyUnsubscribed };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { operation: 'unsubscribe_by_token' },
      level: 'error',
    });
    return { ok: false, email: null, alreadyUnsubscribed: false };
  }
}

export interface LookupContactResult {
  ok: boolean;
  email: string | null;
  alreadyUnsubscribed: boolean;
}

/**
 * 토큰으로 contact 정보만 조회 (mutation 없음).
 * GET 페이지 (확인 화면) 에서 사용. POST 요청에서는 unsubscribeByToken 사용.
 */
export async function lookupContactByToken(token: string): Promise<LookupContactResult> {
  if (!UUID_RE.test(token)) {
    return { ok: false, email: null, alreadyUnsubscribed: false };
  }
  try {
    const rows = await db
      .select({
        id: contactTargets.id,
        unsubscribedAt: contactTargets.unsubscribedAt,
        cipher: contactPii.cipher,
        columnKey: contactPii.columnKey,
      })
      .from(contactTargets)
      .leftJoin(
        contactPii,
        and(
          eq(contactPii.contactTargetId, contactTargets.id),
          eq(contactPii.fieldType, 'email'),
        ),
      )
      .where(eq(contactTargets.unsubscribeToken, token))
      .orderBy(asc(contactPii.columnKey))
      .limit(1);

    const existing = rows[0];
    if (!existing) {
      return { ok: false, email: null, alreadyUnsubscribed: false };
    }

    let email: string | null = null;
    if (existing.cipher) {
      try {
        email = decryptPii(existing.cipher);
      } catch {
        // 복호화 실패 시 email 노출 안 함
      }
    }

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
 * POST 폼 액션 — 실제 unsubscribe 처리 후 ?done=1 로 리디렉트.
 */
export async function confirmUnsubscribeAction(token: string): Promise<never> {
  await unsubscribeByToken(token);
  redirect(`/unsubscribe/${encodeURIComponent(token)}?done=1`);
}

export interface AdminRevertUnsubscribeResult {
  ok: boolean;
  error?: string;
}

/**
 * 운영자(admin)가 캠페인 페이지에서 직접 수신거부를 해제.
 *
 * 보안:
 *   - requireAuth 로 인증 게이트
 *   - surveyId scope 일치 검증 — 다른 설문의 컨택을 임의로 건드리지 못하게 차단
 *
 * 멱등성: 이미 해제된 행이어도 ok 반환 (UI 가 stale 한 상태에서 두 번 눌러도 무해).
 */
export async function revertUnsubscribeByContactIdAction(
  contactId: string,
  surveyId: string,
): Promise<AdminRevertUnsubscribeResult> {
  await requireAuth();
  if (!UUID_RE.test(contactId) || !UUID_RE.test(surveyId)) {
    return { ok: false, error: '잘못된 요청입니다.' };
  }

  try {
    const result = await clearUnsubscribed(
      and(eq(contactTargets.id, contactId), eq(contactTargets.surveyId, surveyId))!,
    );
    if (!result) {
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

/**
 * 되돌리기 — form action 으로 호출. token 은 .bind(null, token) 로 partial 적용.
 * 처리 후 /unsubscribe/restored 로 redirect — 같은 페이지로 돌아가면 즉시 재해지되는
 * 루프 방지. DB 장애 시에도 redirect 는 진행 (사용자에게 무한 로딩 노출 방지).
 */
export async function revertUnsubscribeAction(token: string): Promise<void> {
  if (UUID_RE.test(token)) {
    try {
      await clearUnsubscribed(eq(contactTargets.unsubscribeToken, token));
    } catch (err) {
      Sentry.captureException(err, {
        tags: { operation: 'revert_unsubscribe' },
        level: 'error',
      });
    }
  }
  redirect('/unsubscribe/restored');
}
