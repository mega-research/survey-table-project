import 'server-only';

import { randomUUID } from 'node:crypto';

import * as Sentry from '@sentry/nextjs';
import { Resend } from 'resend';

import type { MailAttachment } from '@/db/schema/schema-types';
import { downloadR2Object } from '@/lib/image-utils-server';
import { MAX_ATTACHMENT_TOTAL_BYTES } from '@/lib/mail/constants';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY 환경변수가 설정되지 않았습니다.');
    _resend = new Resend(apiKey);
  }
  return _resend;
}

export interface ResolvedBulkAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

/**
 * 캠페인 첨부 R2 다운로드 — dispatcher 가 캠페인 시작 시 1회만 호출해 N건 재사용.
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
  /** "{fromName} <{fromLocal}@{fromDomain}>" 형식. 캠페인 단위 동일. */
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

const BATCH_CHUNK_SIZE = 50;

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

      // permissive 모드: data.data = 성공한 row(순서 유지, 실패는 빠짐) + data.errors = [{ index, ... }]
      // 위치 매핑이 까다로움 — Resend 의 응답 형식이 SDK 버전마다 변동 가능성 → 보수적 매핑:
      //   1) data.errors 의 index 로 실패 표시
      //   2) 나머지 인덱스는 data.data 의 id 를 순서대로 매핑
      // SDK 가 data 를 sparse 가 아닌 dense array 로 주면 인덱스가 안 맞을 수 있음.
      // → 정밀 매핑이 어려우므로 strict 모드로 한 번 더 안전 시도: error 가 있으면 1건씩 retry.
      const successItems = data.data ?? [];
      const errorItems = ('errors' in data ? data.errors : undefined) ?? [];

      if (errorItems.length === 0) {
        // 모두 성공 — 순서대로 매핑
        for (let i = 0; i < c.length; i++) {
          const item = successItems[i];
          if (item?.id) {
            results.push({ recipientId: c[i].recipientId, resendMessageId: item.id });
          } else {
            results.push({ recipientId: c[i].recipientId, errorReason: 'Resend 응답 id 누락' });
          }
        }
      } else {
        // 부분 실패 — 1명씩 emails.send 로 재시도 (정밀 매핑 보장)
        const fallback = await sendOneByOneInternal(c, input);
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
        attachments: input.attachments,
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
