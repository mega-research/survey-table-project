import 'server-only';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactPii, contactTargets } from '@/db/schema/contacts';
import { mailCampaigns, mailRecipients, mailTemplates, type MailCampaignKind } from '@/db/schema/mail';
import { surveys } from '@/db/schema/surveys';
import type { CampaignFilterSnapshot } from '@/db/schema/schema-types';
import { decryptPii } from '@/lib/crypto/aes';
import { inngest } from '@/lib/inngest/client';
import { withTestPrefix } from '@/lib/mail/test-campaign';
import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';

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
 *     b. next_campaign_run_number(surveyId, isTest) 호출 (scope별 advisory lock)
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
  opts: { kind?: MailCampaignKind } = {},
): Promise<CreateCampaignResult> {
  const kind: MailCampaignKind = opts.kind ?? 'bulk';
  const filterSnapshot: CampaignFilterSnapshot = (input.filterSnapshot ?? {}) as CampaignFilterSnapshot;

  // 중복 선택 ID 제거 — recipientCount/skippedCount 카운터가 중복으로 부풀려지는 것을 방지.
  // 실제 mail_recipients 행은 inArray(SQL IN) + seen Set 으로 이미 dedupe 되므로,
  // 카운터도 unique 기준으로 맞춰야 phantom skipped/recipient 가 발생하지 않는다.
  const uniqueTargetIds = Array.from(new Set(input.contactTargetIds));

  const result = await db.transaction(async (tx) => {
    // a. 현재 운영 scope 잠금. 모드 전환과 캠페인 생성을 직렬화하고 클라이언트 값은 신뢰하지 않는다.
    const [survey] = await tx
      .select({ enabled: surveys.testModeEnabled })
      .from(surveys)
      .where(eq(surveys.id, input.surveyId))
      .for('share');
    if (!survey) {
      throw new Error('설문을 찾을 수 없습니다.');
    }
    const isTest = survey.enabled;

    // 작성 화면을 연 뒤 모드가 바뀌었거나 반대 scope ID가 섞이면 현재 scope로 강등하지 않는다.
    const selectedTargets = await tx
      .select({ id: contactTargets.id, isTest: contactTargets.isTest })
      .from(contactTargets)
      .where(
        and(
          eq(contactTargets.surveyId, input.surveyId),
          eq(contactTargets.isTest, isTest),
          inArray(contactTargets.id, uniqueTargetIds),
        ),
      );
    if (selectedTargets.length !== uniqueTargetIds.length) {
      throw new Error('운영 모드가 변경되었습니다. 화면을 새로고침한 뒤 다시 시도하세요.');
    }

    // b. 템플릿 fetch — 실제/테스트 캠페인이 같은 템플릿을 공유한다.
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

    // c. scope별 next run number — 단건은 1000001+ 대역으로 격리
    const runRows = await tx.execute<{ next_id: number }>(
      kind === 'single'
        ? sql`SELECT next_single_send_run_number(${input.surveyId}, ${isTest}) AS next_id`
        : sql`SELECT next_campaign_run_number(${input.surveyId}, ${isTest}) AS next_id`,
    );
    const runNumber = Number(runRows[0]?.next_id ?? 0);
    if (!runNumber) {
      throw new Error('회차 번호 발급에 실패했습니다.');
    }

    // d. campaign insert (스냅샷 explicit field set — spread 금지)
    const [campaign] = await tx
      .insert(mailCampaigns)
      .values({
        surveyId: input.surveyId,
        isTest,
        mailTemplateId: template.id,
        runNumber,
        kind,
        title: withTestPrefix(input.title.trim(), isTest),
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

    // e. valid contact 재페치 — contact_pii 에서 email cipher 까지 같이 가져옴.
    //    한 컨택에 email 컬럼이 여러 개면 column_key 알파벳 순 첫 번째 사용 (앞에서 dedupe).
    //    preflight(preflightRecipients) 와 동일 정책으로 부정 결과코드(연락금지) 컨택을 제외한다.
    //    제외하지 않으면 preflight 는 제외했다고 보고하나 실제로는 발송되는 미스매치 발생.
    const { buildNegativeCodeExists, getResultCodeStatuses } = await import(
      '@/lib/operations/result-code-statuses.server'
    );
    const { negative: negativeCodes } = await getResultCodeStatuses(input.surveyId);
    const notExcludedByCode = sql`NOT ${buildNegativeCodeExists(
      negativeCodes,
      sql`"contact_targets"."id"`,
    )}`;

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
          eq(contactTargets.isTest, isTest),
          inArray(contactTargets.id, uniqueTargetIds),
          isNull(contactTargets.unsubscribedAt),
          notExcludedByCode,
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
    const skippedCount = uniqueTargetIds.length - validCount;

    if (validCount === 0) {
      throw new Error('발송 가능한 수신자가 없습니다. 수신거부 또는 이메일 누락 확인이 필요합니다.');
    }

    // f. mail_recipients 벌크 insert (queued)
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

    // g. 카운터 초기값
    await tx
      .update(mailCampaigns)
      .set({
        recipientCount: uniqueTargetIds.length,
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
  const scope = await loadOperationsDataScope(surveyId);

  const [scheme, resultCodes] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
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

  const total = await countCampaignCandidates({ surveyId, scope, clauses, unrespondedOnly });
  const MAX_IDS = 10_000;
  if (total > MAX_IDS) {
    throw new Error(
      `필터에 해당하는 수신자가 ${total.toLocaleString('ko-KR')}명입니다. 한 단체 메일당 최대 ${MAX_IDS.toLocaleString('ko-KR')}명 — 필터를 좁혀주세요.`,
    );
  }

  // page=1, pageSize=total 로 한 번에 전체 페치
  const result = await previewCampaignCandidates({
    surveyId,
    scope,
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
  const scope = await loadOperationsDataScope(surveyId);
  const result = await preflightRecipients({ surveyId, scope, selectedContactIds });
  return {
    validCount: result.validIds.length,
    unsubscribedCount: result.unsubscribedIds.length,
    excludedByCodeCount: result.excludedByCodeIds.length,
    emailMissingCount: result.emailMissingIds.length,
    notFoundCount: result.notFoundIds.length,
  };
}
