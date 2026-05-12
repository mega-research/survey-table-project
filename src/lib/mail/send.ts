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

interface ResolvedAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

/**
 * 첨부 배열을 R2 에서 다운로드해 Resend 의 attachments 파라미터 형식으로 변환.
 * - 총합 한도 초과는 발송 자체 차단
 * - 개별 다운로드 실패 시 어떤 파일이 실패했는지 사용자 메시지에 노출 + Sentry 보고
 */
async function resolveAttachments(
  attachments: MailAttachment[],
): Promise<ResolvedAttachment[]> {
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
          tags: { operation: 'mail_attachment_download' },
          extra: { key: a.key, filename: a.filename },
        });
        // 사용자에게는 파일명만 노출 (R2 key 는 디버깅용 — Sentry 에 기록됨)
        throw new Error(`'${a.filename}' 파일을 불러올 수 없습니다.`);
      }
    }),
  );
}

export interface SendTestMailInput {
  to: string;
  subject: string;
  fromName: string;
  fromLocal: string;
  fromDomain: string;
  replyTo: string;
  html: string;
  attachments?: MailAttachment[];
}

export interface SendTestMailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendTestMail(input: SendTestMailInput): Promise<SendTestMailResult> {
  const from = `${input.fromName} <${input.fromLocal}@${input.fromDomain}>`;

  let resolvedAttachments: ResolvedAttachment[] | undefined;
  if (input.attachments && input.attachments.length > 0) {
    try {
      resolvedAttachments = await resolveAttachments(input.attachments);
    } catch (err) {
      const message = err instanceof Error ? err.message : '첨부 다운로드 실패';
      return { ok: false, error: `첨부 파일 준비 실패: ${message}` };
    }
  }

  const { data, error } = await getResend().emails.send({
    from,
    to: [input.to],
    replyTo: input.replyTo,
    subject: input.subject,
    html: input.html,
    headers: { 'X-Entity-Ref-ID': randomUUID() },
    tags: [{ name: 'kind', value: 'template-test' }],
    attachments: resolvedAttachments,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id };
}
