import 'server-only';

import { randomUUID } from 'node:crypto';

import * as Sentry from '@sentry/nextjs';
import type { MailAttachment } from '@/db/schema/schema-types';
import { downloadR2Object } from '@/lib/image-utils-server';
import { MAX_ATTACHMENT_TOTAL_BYTES } from '@/lib/mail/constants';
import { getResend } from '@/lib/mail/resend-client';

export interface ResolvedBulkAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

/**
 * 단체 메일 첨부 R2 다운로드 — dispatcher 가 단체 메일 시작 시 1회만 호출해 N건 재사용.
 * 총합 한도 초과 시 발송 차단.
 */
export async function resolveCampaignAttachments(
  attachments: MailAttachment[],
): Promise<ResolvedBulkAttachment[]> {
  const declaredTotal = attachments.reduce((sum, a) => sum + a.size, 0);
  if (declaredTotal > MAX_ATTACHMENT_TOTAL_BYTES) {
    throw new Error(
      `첨부 총합이 한도를 초과합니다 (${Math.round(declaredTotal / 1024 / 1024)}MB / ${Math.round(MAX_ATTACHMENT_TOTAL_BYTES / 1024 / 1024)}MB).`,
    );
  }
  return Promise.all(
    attachments.map(async (a) => {
      try {
        return {
          filename: a.filename,
          content: await downloadR2Object(a.key),
          contentType: a.mime,
        };
      } catch (err) {
        Sentry.captureException(err, {
          tags: { operation: 'campaign_attachment_download' },
          extra: { key: a.key, filename: a.filename },
        });
        throw new Error(`'${a.filename}' 파일을 불러올 수 없습니다.`);
      }
    }),
  );
}

export interface BulkRecipientInput {
  /** 호출자(dispatcher) 가 mail_recipients.id 매핑용으로 사용 */
  recipientId: string;
  to: string;
  subject: string;
  html: string;
}

export interface BulkSendInput {
  /** "{fromName} <{fromLocal}@{fromDomain}>" 형식. 단체 메일 단위 동일. */
  from: string;
  replyTo: string;
  attachments?: ResolvedBulkAttachment[];
  /** Resend tag — webhook payload tag 로 같이 옴 (분석 보조) */
  campaignId: string;
  recipients: BulkRecipientInput[];
}

export interface BulkSendResultItem {
  recipientId: string;
  resendMessageId?: string;
  errorReason?: string;
}

export interface CampaignRecipientSendInput {
  from: string;
  replyTo: string;
  attachments?: ResolvedBulkAttachment[];
  campaignId: string;
  idempotencyKey: string;
  recipient: BulkRecipientInput;
}

export type CampaignRecipientSendResult =
  | { kind: 'accepted'; resendMessageId: string }
  | { kind: 'permanent_failure'; errorReason: string };

export class RetryableCampaignSendError extends Error {
  override readonly name = 'RetryableCampaignSendError';
}

const RETRYABLE_RESEND_ERROR_NAMES = new Set([
  'application_error',
  'concurrent_idempotent_requests',
  'internal_server_error',
  'rate_limit_exceeded',
]);

function isPermanentResendError(error: {
  name: string;
  statusCode: number | null;
}): boolean {
  if (error.statusCode === 429) return false;
  if (RETRYABLE_RESEND_ERROR_NAMES.has(error.name)) return false;
  return error.statusCode !== null && error.statusCode >= 400 && error.statusCode < 500;
}

/** recipient별 고정 payload와 idempotency key로 Resend 단건 발송을 수행한다. */
export async function sendCampaignRecipient(
  input: CampaignRecipientSendInput,
): Promise<CampaignRecipientSendResult> {
  const resend = getResend();
  const { recipient } = input;
  const { data, error } = await resend.emails.send(
    {
      from: input.from,
      to: [recipient.to],
      replyTo: input.replyTo,
      subject: recipient.subject,
      html: recipient.html,
      headers: { 'X-Entity-Ref-ID': input.idempotencyKey },
      tags: [
        { name: 'kind', value: 'campaign' },
        { name: 'campaign_id', value: input.campaignId },
        { name: 'recipient_id', value: recipient.recipientId },
      ],
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
    },
    { idempotencyKey: input.idempotencyKey },
  );

  if (error) {
    if (isPermanentResendError(error)) {
      return { kind: 'permanent_failure', errorReason: error.message };
    }
    throw new RetryableCampaignSendError(error.message);
  }
  if (!data?.id) throw new RetryableCampaignSendError('Resend 응답 id 누락');
  return { kind: 'accepted', resendMessageId: data.id };
}

const BATCH_CHUNK_SIZE = 50;

/** batch.send permissive 응답의 성공 row(id) — data.data 요소 형태 */
export interface BatchSuccessItem {
  id?: string;
}

/** batch.send permissive 응답의 실패 row — data.errors 요소 형태. index 는 원본 payload 위치. */
export interface BatchErrorItem {
  index: number;
  message?: string;
}

/**
 * batch.send permissive 응답을 recipient 단위 결과로 매핑한다.
 *
 * Resend 규약:
 *   - data.errors[].index = 원본 payload 배열에서 실패한 위치
 *   - data.data = 성공한 row(id) 만 순서대로 담긴 dense 배열(실패 위치는 빠짐)
 *
 * 따라서 실패 인덱스 집합을 만들고, 성공 인덱스만 data.data 를 순서대로 소비해 매핑한다.
 * 실패 인덱스는 재시도 대상으로 분리해 반환 — 이미 성공한 수신자에게 중복 발송하지 않도록.
 */
export function mapBatchResults(
  chunkRecipients: BulkRecipientInput[],
  successItems: BatchSuccessItem[],
  errorItems: BatchErrorItem[],
): { resolved: BulkSendResultItem[]; retryIndices: number[] } {
  const failedIndices = new Set(errorItems.map((e) => e.index));
  const resolved: BulkSendResultItem[] = [];
  const retryIndices: number[] = [];

  let successCursor = 0;
  for (let i = 0; i < chunkRecipients.length; i++) {
    const recipient = chunkRecipients[i];
    if (!recipient) continue;
    if (failedIndices.has(i)) {
      // 실패분 — 1건씩 재시도해야 하므로 결과를 확정하지 않고 인덱스만 모은다.
      retryIndices.push(i);
      continue;
    }
    const item = successItems[successCursor];
    successCursor += 1;
    if (item?.id) {
      resolved.push({ recipientId: recipient.recipientId, resendMessageId: item.id });
    } else {
      resolved.push({ recipientId: recipient.recipientId, errorReason: 'Resend 응답 id 누락' });
    }
  }

  return { resolved, retryIndices };
}

/**
 * Resend `batch.send` 는 SDK 타입(CreateBatchEmailOptions)이 attachments 를 제외 — 첨부 미지원.
 * 따라서 첨부 유무로 분기.
 *   - 첨부 없음: batch.send (batchValidation='permissive' 로 per-item errors 매핑 가능)
 *   - 첨부 있음: emails.send 순차 호출 (rate limit 은 Inngest step retry 가 보강)
 */
export async function sendCampaignBatch(input: BulkSendInput): Promise<BulkSendResultItem[]> {
  const hasAttachments = (input.attachments?.length ?? 0) > 0;
  return hasAttachments ? sendOneByOne(input) : sendInBatches(input);
}

async function sendInBatches(input: BulkSendInput): Promise<BulkSendResultItem[]> {
  const resend = getResend();
  const results: BulkSendResultItem[] = [];
  const chunks = chunk(input.recipients, BATCH_CHUNK_SIZE);

  for (const c of chunks) {
    const payloads = c.map((r) => ({
      from: input.from,
      to: [r.to],
      replyTo: input.replyTo,
      subject: r.subject,
      html: r.html,
      headers: { 'X-Entity-Ref-ID': randomUUID() },
      tags: [
        { name: 'kind', value: 'campaign' },
        { name: 'campaign_id', value: input.campaignId },
      ],
    }));

    try {
      const { data, error } = await resend.batch.send(payloads, {
        batchValidation: 'permissive',
      });

      // 전체 fail (rate limit / 인증 등) — 청크 전부 errorReason
      if (error || !data) {
        const message = error?.message ?? 'batch.send 응답 누락';
        for (const r of c) {
          results.push({ recipientId: r.recipientId, errorReason: message });
        }
        continue;
      }

      // permissive 모드: data.data = 성공한 row(순서 유지, 실패는 빠진 dense 배열)
      //                  data.errors = [{ index, message }] (index = 원본 payload 위치)
      const successItems = data.data ?? [];
      const errorItems = ('errors' in data ? data.errors : undefined) ?? [];

      const { resolved, retryIndices } = mapBatchResults(c, successItems, errorItems);
      results.push(...resolved);

      // 실패분만 1건씩 emails.send 로 재시도 — 이미 성공한 수신자는 제외해 중복 발송/메시지 id 유실 방지.
      if (retryIndices.length > 0) {
        const retryRecipients = retryIndices
          .map((i) => c[i])
          .filter((r): r is BulkRecipientInput => r !== undefined);
        const fallback = await sendOneByOneInternal(retryRecipients, input);
        results.push(...fallback);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'batch.send 예외';
      for (const r of c) {
        results.push({ recipientId: r.recipientId, errorReason: message });
      }
    }
  }
  return results;
}

async function sendOneByOne(input: BulkSendInput): Promise<BulkSendResultItem[]> {
  return sendOneByOneInternal(input.recipients, input);
}

async function sendOneByOneInternal(
  recipients: BulkRecipientInput[],
  input: BulkSendInput,
): Promise<BulkSendResultItem[]> {
  const resend = getResend();
  const results: BulkSendResultItem[] = [];

  for (const r of recipients) {
    try {
      const { data, error } = await resend.emails.send({
        from: input.from,
        to: [r.to],
        replyTo: input.replyTo,
        subject: r.subject,
        html: r.html,
        headers: { 'X-Entity-Ref-ID': randomUUID() },
        tags: [
          { name: 'kind', value: 'campaign' },
          { name: 'campaign_id', value: input.campaignId },
        ],
        ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
      });
      if (error) {
        results.push({ recipientId: r.recipientId, errorReason: error.message });
        continue;
      }
      if (data?.id) {
        results.push({ recipientId: r.recipientId, resendMessageId: data.id });
      } else {
        results.push({ recipientId: r.recipientId, errorReason: 'Resend 응답 id 누락' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'emails.send 예외';
      results.push({ recipientId: r.recipientId, errorReason: message });
    }
  }
  return results;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
