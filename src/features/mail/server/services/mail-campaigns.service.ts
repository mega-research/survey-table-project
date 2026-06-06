import 'server-only';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactPii, contactTargets } from '@/db/schema/contacts';
import { mailCampaigns, mailRecipients, mailTemplates } from '@/db/schema/mail';
import type { CampaignFilterSnapshot } from '@/db/schema/schema-types';
import { decryptPii } from '@/lib/crypto/aes';
import { inngest } from '@/lib/inngest/client';

import type {
  CancelCampaignInput,
  CreateCampaignInput,
  CreateCampaignResult,
  FetchCandidateIdsInput,
  FetchCandidateIdsResult,
  PreviewPreflightInput,
  PreviewPreflightResult,
} from '../../domain/mail-campaign';

/**
 * 단체 메일 생성 + 발송 큐잉.
 *
 * 흐름:
 *  1. 트랜잭션:
 *     a. 템플릿 fetch → 스냅샷 컬럼 채움
 *     b. next_campaign_run_number(surveyId) 호출 (advisory lock)
 *     c. mail_campaigns insert (status='queued')
 *     d. 선택된 contact 재페치 (unsubscribed_at IS NULL AND email IS NOT NULL)
 *     e. valid contact → mail_recipients(status='queued') 벌크 insert
 *     f. 카운터 초기값 UPDATE (recipient_count = total selected, queued_count = valid,
 *        skipped_unsubscribed_count = selected - valid)
 *  2. 트랜잭션 commit 후 Inngest event emit `mail/campaign.queued`.
 *     실패 시 campaign status → 'draft' 보상 롤백 (비-트랜잭션 db.update).
 *
 * 인증/캐시 갱신은 procedure(authed) + 소비처 router.push 가 담당.
 * userId 는 authed context.user.id 를 procedure 가 주입.
 */
export async function createCampaign(
  input: CreateCampaignInput,
  userId: string,
): Promise<CreateCampaignResult> {
  const filterSnapshot: CampaignFilterSnapshot = (input.filterSnapshot ?? {}) as CampaignFilterSnapshot;

  const result = await db.transaction(async (tx) => {
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

    // c. campaign insert (스냅샷 explicit field set — spread 금지)
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
        createdBy: userId,
        status: 'queued',
      })
      .returning({ id: mailCampaigns.id });
    if (!campaign) {
      throw new Error('단체 메일 생성에 실패했습니다.');
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

    // 단체 메일 대비 chunk insert (Postgres parameter limit 65535 → 1 row ≈ 5 params → 안전마진 5000)
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

  // 트랜잭션 commit 후 Inngest event emit. 실패 시 status='draft' 보상 롤백.
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
    const message = err instanceof Error ? err.message : '발송 큐 등록에 실패했습니다.';
    throw new Error(
      `단체 메일은 저장됐지만 발송 큐 등록에 실패했습니다 — ${message}. Inngest dev 서버 가 실행 중인지 확인하세요.`,
    );
  }

  return result;
}

/**
 * 단체 메일 취소 — status IN ('draft','queued') 일 때만.
 * 'sending' 진행 중 단체 메일은 Inngest dispatcher 가 status='queued' 가드로 이미
 * 발송된 row 는 그대로 두고 미발송 row 만 영향. 단순화를 위해 sending 이후는 취소 불가.
 */
export async function cancelCampaign(input: CancelCampaignInput): Promise<void> {
  const updated = await db
    .update(mailCampaigns)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(mailCampaigns.id, input.campaignId),
        eq(mailCampaigns.surveyId, input.surveyId),
        inArray(mailCampaigns.status, ['draft', 'queued']),
      ),
    )
    .returning({ id: mailCampaigns.id });

  if (updated.length === 0) {
    throw new Error('발송 시작 후에는 취소할 수 없습니다.');
  }
}

/**
 * 마법사 "필터 결과 전체 선택" — 현재 필터 조건에 해당하는 모든 contact id 반환.
 * 페이지네이션 없이 일괄 — 단체 메일 최대 10000명 제약 안에서 안전. 더 큰 단체 메일은 제한 에러.
 */
export async function fetchCandidateIds(
  input: FetchCandidateIdsInput,
): Promise<FetchCandidateIdsResult> {
  const { surveyId, filter } = input;

  const { previewCampaignCandidates, countCampaignCandidates } = await import(
    '@/lib/operations/campaigns.server'
  );
  const { getContactColumnScheme, getContactResultCodes, buildColumnCandidates } = await import(
    '@/lib/operations/contacts.server'
  );
  const { parseClausesFromUrl } = await import('@/lib/operations/contacts-filters.server');

  const [scheme, resultCodes] = await Promise.all([
    getContactColumnScheme(surveyId),
    getContactResultCodes(surveyId),
  ]);
  const candidates = buildColumnCandidates(scheme);
  const rawClauses = filter.clauses ?? [];
  const clauses = parseClausesFromUrl(
    rawClauses.map((c) => c.source),
    rawClauses.map((c) => c.value),
    rawClauses.map((c) => c.op ?? ''),
    candidates,
    resultCodes,
  );
  const unrespondedOnly = filter.unrespondedOnly ?? false;

  const total = await countCampaignCandidates({ surveyId, clauses, unrespondedOnly });
  const MAX_IDS = 10_000;
  if (total > MAX_IDS) {
    throw new Error(
      `필터에 해당하는 수신자가 ${total.toLocaleString('ko-KR')}명입니다. 한 단체 메일당 최대 ${MAX_IDS.toLocaleString('ko-KR')}명 — 필터를 좁혀주세요.`,
    );
  }

  // page=1, pageSize=total 로 한 번에 전체 페치
  const result = await previewCampaignCandidates({
    surveyId,
    clauses,
    unrespondedOnly,
    page: 1,
    pageSize: Math.max(1, total),
  });
  return {
    ids: result.rows.map((r) => r.id),
    total,
    truncated: false,
  };
}

/**
 * 마법사 ⑤ preflight — campaigns.server 의 preflightRecipients 를 한 번 더 노출.
 */
export async function previewPreflight(
  input: PreviewPreflightInput,
): Promise<PreviewPreflightResult> {
  const { surveyId, selectedContactIds } = input;

  const { preflightRecipients } = await import('@/lib/operations/campaigns.server');
  const result = await preflightRecipients({ surveyId, selectedContactIds });
  return {
    validCount: result.validIds.length,
    unsubscribedCount: result.unsubscribedIds.length,
    excludedByCodeCount: result.excludedByCodeIds.length,
    emailMissingCount: result.emailMissingIds.length,
    notFoundCount: result.notFoundIds.length,
  };
}
