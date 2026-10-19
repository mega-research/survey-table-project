import { ORPCError } from '@orpc/server';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactPii, contactTargets } from '@/db/schema/contacts';
import {
  type MailCampaignKind,
  mailCampaigns,
  mailRecipients,
  mailTemplates,
} from '@/db/schema/mail';
import { resolveMailEmailOrder } from '@/lib/contacts/mail-email-order';
import { inngest } from '@/lib/inngest/client';
import { resolveSendAddress } from '@/lib/mail/send-address';
import { withTestPrefix } from './test-campaign';
import { loadOperationsDataScope, lockWriteScope } from '@/server/data-scope';
import {
  NO_BOUNCED_ADDRESSES,
  decryptSendAddressCells,
  emailCandidateSql,
  emailOrderSql,
  loadBouncedAddresses,
} from '@/server/read-models/send-address';
import type { CampaignFilterSnapshot } from '@/shared/contracts/mail';

import type {
  CancelCampaignInput,
  CreateCampaignInput,
  CreateCampaignResult,
  FetchCandidateIdsInput,
  FetchCandidateIdsResult,
  PreviewPreflightInput,
  PreviewPreflightResult,
  ResyncCampaignInput,
  ResyncCampaignResult,
} from '../domain/mail-campaign';

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
 * 인증/캐시 갱신은 procedure(scoped) + 소비처 router.push 가 담당.
 * userId 는 인증된 context.user.id 를 procedure 가 주입. isGuest 도 procedure 가
 * context.user.id 에서 파생해 주입 — 서비스는 auth 를 재조회하지 않는다.
 */
export async function createCampaign(
  input: CreateCampaignInput,
  userId: string,
  isGuest: boolean,
  opts: { kind?: MailCampaignKind } = {},
): Promise<CreateCampaignResult> {
  const kind: MailCampaignKind = opts.kind ?? 'bulk';
  const filterSnapshot: CampaignFilterSnapshot = (input.filterSnapshot ??
    {}) as CampaignFilterSnapshot;

  // 중복 선택 ID 제거 — recipientCount/skippedCount 카운터가 중복으로 부풀려지는 것을 방지.
  // 실제 mail_recipients 행은 inArray(SQL IN) + seen Set 으로 이미 dedupe 되므로,
  // 카운터도 unique 기준으로 맞춰야 phantom skipped/recipient 가 발생하지 않는다.
  const uniqueTargetIds = Array.from(new Set(input.contactTargetIds));

  const result = await db.transaction(async (tx) => {
    // a. 현재 운영 scope 잠금. 모드 전환과 캠페인 생성을 직렬화하고 클라이언트 값은 신뢰하지 않는다.
    //    같은 잠금으로 컬럼 설정도 읽는다 — 발송 주소 순서가 캠페인 생성 도중 바뀌지 않는다.
    const locked = await lockWriteScope(tx, input.surveyId, isGuest, {
      lock: 'share',
      columns: ['contactColumns', 'testContactColumns'],
    });
    if (!locked) {
      throw new Error('설문을 찾을 수 없습니다.');
    }
    const { isTest } = locked;
    const emailOrder = resolveMailEmailOrder(
      isTest ? locked.row.testContactColumns : locked.row.contactColumns,
    );

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

    // e. valid contact 재페치 — contact_pii 에서 발송 주소 후보 칸까지 같이 가져온다.
    //    어느 주소로 보낼지는 발송 주소 규칙(resolveSendAddress) 하나가 정한다 — 발송 주소 순서대로
    //    보낼 수 있는 첫 칸이고, 반송된 칸·주소는 건너뛰어 다음 순위로 넘어간다. 보낼 곳이 남지 않으면
    //    그 컨택은 빠진다. 사전 점검(preflightRecipients)이 같은 규칙으로 센다.
    //    preflight 와 동일 정책으로 부정 결과코드(연락금지) 컨택을 제외한다.
    //    반송 건너뛰기는 bulk 전용 — 단건(kind='single')은 관리자가 특정 컨택을 지목한 의도적
    //    발송이므로 반송 주소여도 허용한다 (2026-08-13 결정).
    const { buildNegativeCodeExists, getResultCodeStatuses } =
      await import('@/server/read-models/result-code-statuses');
    const { latestResultUnsubscribedSql } =
      await import('@/lib/operations/contacts-filter-sql.server');
    const [{ negative: negativeCodes }, bounced] = await Promise.all([
      getResultCodeStatuses(input.surveyId),
      kind === 'single' ? Promise.resolve(NO_BOUNCED_ADDRESSES) : loadBouncedAddresses(input.surveyId),
    ]);
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
        and(eq(contactPii.contactTargetId, contactTargets.id), emailCandidateSql(emailOrder)),
      )
      .where(
        and(
          eq(contactTargets.surveyId, input.surveyId),
          eq(contactTargets.isTest, isTest),
          inArray(contactTargets.id, uniqueTargetIds),
          isNull(contactTargets.unsubscribedAt),
          // 최근 결과코드 수신거부 — status(negative) 무관하게 발송 제외 (수신거부 3축).
          sql`NOT (${latestResultUnsubscribedSql})`,
          notExcludedByCode,
        ),
      )
      .orderBy(asc(contactTargets.id), asc(emailOrderSql(emailOrder)));

    const inviteTokens = new Map(piiJoined.map((r) => [r.id, r.inviteToken]));
    const cellsByTarget = decryptSendAddressCells(
      piiJoined.map((r) => ({ contactTargetId: r.id, columnKey: r.columnKey, cipher: r.cipher })),
    );
    const validContacts: Array<{
      id: string;
      email: string;
      columnKey: string;
      inviteToken: string;
    }> = [];
    for (const [id, cells] of cellsByTarget) {
      const resolved = resolveSendAddress(cells, (v) => bounced.has(v));
      if (resolved.kind !== 'send') continue;
      validContacts.push({
        id,
        email: resolved.email,
        columnKey: resolved.columnKey,
        inviteToken: inviteTokens.get(id)!,
      });
    }

    const validCount = validContacts.length;
    const skippedCount = uniqueTargetIds.length - validCount;

    if (validCount === 0) {
      throw new Error(
        '발송 가능한 수신자가 없습니다. 수신거부, 반송 이력 또는 이메일 누락 확인이 필요합니다.',
      );
    }

    // f. mail_recipients 벌크 insert (queued)
    const recipientRows = validContacts.map((c) => ({
      campaignId: campaign.id,
      contactTargetId: c.id,
      emailSnapshot: c.email,
      // 대체 발송이 「다음 순위 열」을 고를 때 기준이 된다.
      emailColumnKey: c.columnKey,
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
 *
 * isGuest 는 procedure 가 인증된 context.user.id 에서 파생해 전달한다 — 게스트는 전역
 * 테스트 모드 플래그와 무관하게 항상 real 파티션만 쓴다. UPDATE WHERE 에 isTest 조건을
 * 넣어, 게스트가 테스트 파티션 campaignId 를 알아내도 취소가 닿지 않게 한다 — 파티션이
 * 안 맞으면 상태가 안 맞는 캠페인과 동일하게 처리(별도 에러 계약을 만들지 않는다).
 */
export async function cancelCampaign(input: CancelCampaignInput, isGuest: boolean): Promise<void> {
  // createCampaign(a단계)과 동일한 최소 조회 — 쓰기 파티션 산정을 위해서만 필요.
  const locked = await lockWriteScope(db, input.surveyId, isGuest, { lock: 'none' });
  const isTest = locked?.isTest ?? false;

  const updated = await db
    .update(mailCampaigns)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(mailCampaigns.id, input.campaignId),
        eq(mailCampaigns.surveyId, input.surveyId),
        eq(mailCampaigns.isTest, isTest),
        inArray(mailCampaigns.status, ['draft', 'queued']),
      ),
    )
    .returning({ id: mailCampaigns.id });

  if (updated.length === 0) {
    throw new Error('발송 시작 후에는 취소할 수 없습니다.');
  }
}

/**
 * 발송 후 멈춘 수신자 상태를 Resend 실제 상태로 재조회한다 (수동 reconcile).
 *
 * Inngest 자동 reconcile 은 발송 후 1m/5m/30m 3회뿐이라, 그 이후 도착한 webhook 이
 * 유실되면 수신자가 영구히 queued/sending/sent 에 남는다. 그 잔여분을 운영자가
 * 직접 회수하기 위한 진입점 — 내부 로직은 자동 reconcile 과 완전히 동일하다.
 *
 * 다른 설문의 캠페인 id 를 넘겨 남의 데이터를 건드리는 것을 막기 위해 surveyId 소유를 먼저 확인한다.
 */
export async function resyncCampaign(input: ResyncCampaignInput): Promise<ResyncCampaignResult> {
  const [campaign] = await db
    .select({ id: mailCampaigns.id })
    .from(mailCampaigns)
    .where(and(eq(mailCampaigns.id, input.campaignId), eq(mailCampaigns.surveyId, input.surveyId)))
    .limit(1);

  if (!campaign) throw new Error('단체 메일을 찾을 수 없습니다.');

  const { reconcileCampaignRecipients } = await import('./campaign-reconcile');
  return reconcileCampaignRecipients(input.campaignId);
}

/**
 * 마법사 "필터 결과 전체 선택" — 현재 필터 조건에 해당하는 모든 contact id 반환.
 * 페이지네이션 없이 일괄 — 단체 메일 최대 10000명 제약 안에서 안전. 더 큰 단체 메일은 제한 에러.
 */
export async function fetchCandidateIds(
  input: FetchCandidateIdsInput,
  isGuest: boolean,
): Promise<FetchCandidateIdsResult> {
  const { surveyId, filter } = input;

  const { previewCampaignCandidates, countCampaignCandidates } =
    await import('./campaigns-read');
  const { loadContactFilterContext, resolveContactFilter } = await import(
    '@/server/read-models/contact-filter-resolution'
  );
  const scope = await loadOperationsDataScope(surveyId);

  // 마법사 페이지와 같은 컨텍스트·같은 해석 — 어긋나면 "필터 결과 전체 선택"이 화면에 보이는
  // 명단과 다른 집합을 고른다. 화면을 연 뒤 조건의 컨택원이 지워지는 등으로 해석되지 않는
  // 조건이 생기면 write 해석이 거부한다 — 버리면 화면보다 넓은 명단(빈 조건이면 전체)을 고른다.
  const filterCtx = await loadContactFilterContext(surveyId, scope, { isGuest, surface: 'mail' });
  const resolved = await resolveContactFilter(filterCtx, filter, { mode: 'write' });
  const unrespondedOnly = filter.unrespondedOnly ?? false;

  const total = await countCampaignCandidates({
    surveyId,
    scope,
    filter: resolved,
    unrespondedOnly,
  });
  const MAX_IDS = 10_000;
  if (total > MAX_IDS) {
    throw new ORPCError('BAD_REQUEST', {
      message:
        `필터에 해당하는 수신자가 ${total.toLocaleString('ko-KR')}명입니다. 한 단체 메일당 최대 ${MAX_IDS.toLocaleString('ko-KR')}명 — 필터를 좁혀주세요.`,
    });
  }

  // page=1, pageSize=total 로 한 번에 전체 페치
  const result = await previewCampaignCandidates({
    surveyId,
    scope,
    filter: resolved,
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
 * 마법사 ⑤ preflight — campaigns-read 의 preflightRecipients 를 한 번 더 노출.
 */
export async function previewPreflight(
  input: PreviewPreflightInput,
): Promise<PreviewPreflightResult> {
  const { surveyId, selectedContactIds } = input;

  const { preflightRecipients } = await import('./campaigns-read');
  const [scope, bounced] = await Promise.all([
    loadOperationsDataScope(surveyId),
    loadBouncedAddresses(surveyId),
  ]);
  const result = await preflightRecipients({
    surveyId,
    scope,
    selectedContactIds,
    bounced,
  });
  return {
    validCount: result.validIds.length,
    unsubscribedCount: result.unsubscribedIds.length,
    excludedByCodeCount: result.excludedByCodeIds.length,
    emailMissingCount: result.emailMissingIds.length,
    bouncedCount: result.bouncedIds.length,
    notFoundCount: result.notFoundIds.length,
  };
}
