'use server';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { contactPii, contactTargets } from '@/db/schema/contacts';
import { mailCampaigns, mailRecipients, mailTemplates } from '@/db/schema/mail';
import type { CampaignFilterSnapshot } from '@/db/schema/schema-types';
import { requireAuth } from '@/lib/auth';
import { decryptPii } from '@/lib/crypto/aes';
import { inngest } from '@/lib/inngest/client';

interface ActionResult<T = void> {
  ok: boolean;
  error?: string;
  data?: T;
}

const filterSnapshotSchema = z
  .object({
    qfield: z.enum(['all', 'resid', 'email', 'group', 'biz']).optional(),
    q: z.string().optional(),
    unrespondedOnly: z.boolean().optional(),
    resultCodes: z.array(z.string()).optional(),
    groupValues: z.array(z.string()).optional(),
    unopenedFromCampaignId: z.string().uuid().optional(),
    unopenedAfterDays: z.number().int().min(0).max(365).optional(),
  })
  .strict();

const createCampaignInputSchema = z.object({
  surveyId: z.string().uuid(),
  mailTemplateId: z.string().uuid(),
  title: z.string().min(1, '캠페인 제목을 입력하세요.').max(200),
  contactTargetIds: z
    .array(z.string().uuid())
    .min(1, '수신자를 1명 이상 선택하세요.')
    .max(10_000, '한 캠페인에 최대 10,000명까지 발송 가능합니다.'),
  filterSnapshot: filterSnapshotSchema.optional(),
});

export type CreateCampaignInput = z.input<typeof createCampaignInputSchema>;

/**
 * 캠페인 생성 + 발송 큐잉.
 *
 * 흐름:
 *  1. 입력 검증 + 인증
 *  2. 트랜잭션:
 *     a. 템플릿 fetch → 스냅샷 컬럼 채움
 *     b. next_campaign_run_number(surveyId) 호출 (advisory lock)
 *     c. mail_campaigns insert (status='queued')
 *     d. 선택된 contact 재페치 (unsubscribed_at IS NULL AND email IS NOT NULL)
 *     e. valid contact → mail_recipients(status='queued') 벌크 insert
 *     f. 카운터 초기값 UPDATE (recipient_count = total selected, queued_count = valid,
 *        skipped_unsubscribed_count = selected - valid)
 *  3. Inngest event emit `mail/campaign.queued`. 실패 시 campaign status → 'draft' 롤백.
 *  4. revalidatePath
 */
export async function createCampaignAction(
  raw: CreateCampaignInput,
): Promise<ActionResult<{ campaignId: string; queuedCount: number; skippedCount: number }>> {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return { ok: false, error: '인증이 필요합니다.' };
  }

  const parsed = createCampaignInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' };
  }
  const input = parsed.data;
  const filterSnapshot: CampaignFilterSnapshot = input.filterSnapshot ?? {};

  let result: { campaignId: string; queuedCount: number; skippedCount: number } | null = null;

  try {
    result = await db.transaction(async (tx) => {
      // a. 템플릿 fetch
      const [template] = await tx
        .select()
        .from(mailTemplates)
        .where(
          and(
            eq(mailTemplates.id, input.mailTemplateId),
            eq(mailTemplates.surveyId, input.surveyId),
            isNull(mailTemplates.deletedAt),
          ),
        )
        .limit(1);
      if (!template) {
        throw new Error('선택한 메일 템플릿을 찾을 수 없습니다.');
      }

      // b. next run number
      const runRows = await tx.execute<{ next_id: number }>(
        sql`SELECT next_campaign_run_number(${input.surveyId}) AS next_id`,
      );
      const runNumber = Number(runRows[0]?.next_id ?? 0);
      if (!runNumber) {
        throw new Error('회차 번호 발급에 실패했습니다.');
      }

      // c. campaign insert
      const [campaign] = await tx
        .insert(mailCampaigns)
        .values({
          surveyId: input.surveyId,
          mailTemplateId: template.id,
          runNumber,
          title: input.title.trim(),
          subjectSnapshot: template.subject,
          bodyHtmlSnapshot: template.bodyHtml,
          fromLocalSnapshot: template.fromLocal,
          fromNameSnapshot: template.fromName,
          replyToSnapshot: template.replyTo,
          attachmentsSnapshot: template.attachments,
          filterSnapshot,
          createdBy: user.id,
          status: 'queued',
        })
        .returning({ id: mailCampaigns.id });
      if (!campaign) {
        throw new Error('캠페인 생성에 실패했습니다.');
      }

      // d. valid contact 재페치 — contact_pii 에서 email cipher 까지 같이 가져옴.
      //    한 컨택에 email 컬럼이 여러 개면 column_key 알파벳 순 첫 번째 사용 (앞에서 dedupe).
      const piiJoined = await tx
        .select({
          id: contactTargets.id,
          columnKey: contactPii.columnKey,
          cipher: contactPii.cipher,
          inviteToken: contactTargets.inviteToken,
        })
        .from(contactTargets)
        .innerJoin(
          contactPii,
          and(
            eq(contactPii.contactTargetId, contactTargets.id),
            eq(contactPii.fieldType, 'email'),
          ),
        )
        .where(
          and(
            eq(contactTargets.surveyId, input.surveyId),
            inArray(contactTargets.id, input.contactTargetIds),
            isNull(contactTargets.unsubscribedAt),
          ),
        )
        .orderBy(asc(contactTargets.id), asc(contactPii.columnKey));

      const seen = new Set<string>();
      const validContacts: Array<{ id: string; email: string; inviteToken: string }> = [];
      for (const r of piiJoined) {
        if (seen.has(r.id)) continue; // 첫 email 컬럼만
        try {
          const email = decryptPii(r.cipher);
          if (!email || !email.trim()) continue;
          seen.add(r.id);
          validContacts.push({ id: r.id, email, inviteToken: r.inviteToken });
        } catch {
          // 복호화 실패 행은 발송 대상에서 제외 (cipher 손상/키 미스매치)
        }
      }

      const validCount = validContacts.length;
      const skippedCount = input.contactTargetIds.length - validCount;

      if (validCount === 0) {
        throw new Error('발송 가능한 수신자가 없습니다. 수신거부 또는 이메일 누락 확인이 필요합니다.');
      }

      // e. mail_recipients 벌크 insert (queued)
      const recipientRows = validContacts.map((c) => ({
        campaignId: campaign.id,
        contactTargetId: c.id,
        emailSnapshot: c.email,
        inviteTokenSnapshot: c.inviteToken,
        status: 'queued' as const,
      }));

      // 큰 캠페인 대비 chunk insert (Postgres parameter limit 65535 → 1 row ≈ 5 params → 안전마진 5000)
      const INSERT_CHUNK = 5_000;
      for (let i = 0; i < recipientRows.length; i += INSERT_CHUNK) {
        await tx.insert(mailRecipients).values(recipientRows.slice(i, i + INSERT_CHUNK));
      }

      // f. 카운터 초기값
      await tx
        .update(mailCampaigns)
        .set({
          recipientCount: input.contactTargetIds.length,
          queuedCount: validCount,
          skippedUnsubscribedCount: skippedCount,
          updatedAt: new Date(),
        })
        .where(eq(mailCampaigns.id, campaign.id));

      return {
        campaignId: campaign.id,
        queuedCount: validCount,
        skippedCount,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '캠페인 생성 중 오류가 발생했습니다.';
    return { ok: false, error: message };
  }

  if (!result) {
    return { ok: false, error: '캠페인 생성에 실패했습니다.' };
  }

  // 트랜잭션 commit 후 Inngest event emit. 실패 시 status='draft' 롤백.
  try {
    await inngest.send({
      name: 'mail/campaign.queued',
      data: { campaignId: result.campaignId, surveyId: input.surveyId },
    });
  } catch (err) {
    await db
      .update(mailCampaigns)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(eq(mailCampaigns.id, result.campaignId));
    const message =
      err instanceof Error ? err.message : '발송 큐 등록에 실패했습니다.';
    return {
      ok: false,
      error: `캠페인은 저장됐지만 발송 큐 등록에 실패했습니다 — ${message}. Inngest dev 서버 가 실행 중인지 확인하세요.`,
    };
  }

  revalidatePath(`/admin/surveys/${input.surveyId}/operations/mail/campaigns`);
  return { ok: true, data: result };
}

// ─────────────────────────────────────────────────────────────────────────────
// 캠페인 취소 — status IN ('draft','queued') 일 때만.
// 'sending' 진행 중 캠페인은 Inngest dispatcher 가 status='queued' 가드로 이미
// 발송된 row 는 그대로 두고 미발송 row 만 영향. 단순화를 위해 sending 이후는 취소 불가.
// ─────────────────────────────────────────────────────────────────────────────

export async function cancelCampaignAction(
  surveyId: string,
  campaignId: string,
): Promise<ActionResult> {
  try {
    await requireAuth();
  } catch {
    return { ok: false, error: '인증이 필요합니다.' };
  }

  const updated = await db
    .update(mailCampaigns)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(mailCampaigns.id, campaignId),
        eq(mailCampaigns.surveyId, surveyId),
        inArray(mailCampaigns.status, ['draft', 'queued']),
      ),
    )
    .returning({ id: mailCampaigns.id });

  if (updated.length === 0) {
    return { ok: false, error: '발송 시작 후에는 취소할 수 없습니다.' };
  }
  revalidatePath(`/admin/surveys/${surveyId}/operations/mail/campaigns`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 마법사 ⑤ preflight 액션 — UI 가 dialog 표시용으로 호출.
// (campaigns.server.ts 의 preflightRecipients 를 server action 으로 한 번 더 노출)
// ─────────────────────────────────────────────────────────────────────────────

const preflightInputSchema = z.object({
  surveyId: z.string().uuid(),
  selectedContactIds: z.array(z.string().uuid()).max(10_000),
});

// ─────────────────────────────────────────────────────────────────────────────
// 마법사 "필터 결과 전체 선택" 액션 — 현재 필터 조건에 해당하는 모든 contact id 반환.
// 페이지네이션 없이 일괄 — 캠페인 최대 10000명 제약 안에서 안전. 더 큰 캠페인은 제한 메시지.
// ─────────────────────────────────────────────────────────────────────────────

const candidateIdsInputSchema = z.object({
  surveyId: z.string().uuid(),
  filter: filterSnapshotSchema,
});

export async function fetchCandidateIdsAction(
  raw: z.input<typeof candidateIdsInputSchema>,
): Promise<ActionResult<{ ids: string[]; total: number; truncated: boolean }>> {
  try {
    await requireAuth();
  } catch {
    return { ok: false, error: '인증이 필요합니다.' };
  }

  const parsed = candidateIdsInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' };
  }
  const { surveyId, filter } = parsed.data;

  const { previewCampaignCandidates, countCampaignCandidates } = await import(
    '@/lib/operations/campaigns.server'
  );

  const total = await countCampaignCandidates({ surveyId, filter });
  const MAX_IDS = 10_000;
  if (total > MAX_IDS) {
    return {
      ok: false,
      error: `필터에 해당하는 수신자가 ${total.toLocaleString('ko-KR')}명입니다. 한 캠페인 최대 ${MAX_IDS.toLocaleString('ko-KR')}명 — 필터를 좁혀주세요.`,
    };
  }

  // page=1, pageSize=total 로 한 번에 전체 페치
  const result = await previewCampaignCandidates({
    surveyId,
    filter,
    page: 1,
    pageSize: Math.max(1, total),
  });
  return {
    ok: true,
    data: {
      ids: result.rows.map((r) => r.id),
      total,
      truncated: false,
    },
  };
}

export async function previewCampaignPreflightAction(
  raw: z.input<typeof preflightInputSchema>,
): Promise<
  ActionResult<{
    validCount: number;
    unsubscribedCount: number;
    emailMissingCount: number;
    notFoundCount: number;
  }>
> {
  try {
    await requireAuth();
  } catch {
    return { ok: false, error: '인증이 필요합니다.' };
  }

  const parsed = preflightInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' };
  }
  const { surveyId, selectedContactIds } = parsed.data;

  const { preflightRecipients } = await import('@/lib/operations/campaigns.server');
  const result = await preflightRecipients({ surveyId, selectedContactIds });
  return {
    ok: true,
    data: {
      validCount: result.validIds.length,
      unsubscribedCount: result.unsubscribedIds.length,
      emailMissingCount: result.emailMissingIds.length,
      notFoundCount: result.notFoundIds.length,
    },
  };
}
