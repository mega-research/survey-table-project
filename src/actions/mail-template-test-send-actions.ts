'use server';

import { createElement } from 'react';

import { render } from '@react-email/render';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { UNSUBSCRIBE_SANDBOX_TOKEN } from '@/lib/mail/constants';
import { renderForTestSend } from '@/lib/mail/render-for-send';
import { mailAttachmentSchema } from '@/lib/mail/schema';
import { sendTestMail } from '@/lib/mail/send';
import { MailWrapper } from '@/lib/mail/template-wrapper';
import { getFirstContactSample } from '@/lib/operations/contact-sample.server';

const InputSchema = z.object({
  surveyId: z.string().uuid(),
  to: z.string().email('수신자 이메일 형식이 올바르지 않습니다.'),
  subject: z.string().min(1, '제목이 비어있습니다.').max(200),
  bodyHtml: z.string(),
  fromName: z.string().min(1, '발신자 이름이 비어있습니다.'),
  fromLocal: z.string().min(1, '발신자 이메일 local 이 비어있습니다.'),
  replyTo: z.string().email('Reply-To 이메일 형식이 올바르지 않습니다.'),
  attachments: z.array(mailAttachmentSchema).default([]),
});

export type SendTestTemplateMailInput = z.input<typeof InputSchema>;

export interface SendTestTemplateMailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendTestTemplateMailAction(
  raw: SendTestTemplateMailInput,
): Promise<SendTestTemplateMailResult> {
  try {
    await requireAuth();
  } catch {
    return { ok: false, error: '인증이 필요합니다.' };
  }

  const parsed = InputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력 검증 실패' };
  }
  const input = parsed.data;

  const fromDomain = process.env.RESEND_FROM_DOMAIN;
  if (!fromDomain) {
    return { ok: false, error: 'RESEND_FROM_DOMAIN 환경변수가 설정되지 않았습니다.' };
  }

  // 수신거부 링크 빌드 — NEXT_PUBLIC_APP_URL 가 없으면 절대 URL 이 되지 않아
  // 메일 클라이언트에서 클릭이 어디로 갈지 정의되지 않음. 명시적 에러로 차단.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
  if (!baseUrl) {
    return {
      ok: false,
      error: 'NEXT_PUBLIC_APP_URL 환경변수가 설정되지 않았습니다.',
    };
  }
  // 테스트 발송은 항상 sandbox 토큰 — 진짜 컨택의 unsubscribeToken 누출 방지.
  // /unsubscribe/[token] 페이지가 sandbox 토큰을 감지해 안내만 표시.
  const unsubscribeUrl = `${baseUrl}/unsubscribe/${UNSUBSCRIBE_SANDBOX_TOKEN}`;

  const sample = await getFirstContactSample(input.surveyId);

  const rendered = renderForTestSend({
    surveyId: input.surveyId,
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    fromName: input.fromName,
    sample: sample
      ? { attrs: sample.attrs, email: sample.email, inviteUrl: null }
      : null,
  });

  const html = await render(
    createElement(MailWrapper, {
      bodyHtml: rendered.bodyHtml,
      previewText: rendered.subject,
      unsubscribeUrl,
    }),
  );

  try {
    return await sendTestMail({
      to: input.to,
      subject: `[TEST] ${rendered.subject}`,
      fromName: rendered.fromName,
      fromLocal: input.fromLocal,
      fromDomain,
      replyTo: input.replyTo,
      html,
      attachments: input.attachments,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '메일 발송 중 오류가 발생했습니다.';
    return { ok: false, error: message };
  }
}
