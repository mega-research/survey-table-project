import 'server-only';

import { createElement } from 'react';

import { render } from '@react-email/render';

import { UNSUBSCRIBE_SANDBOX_TOKEN } from '@/lib/mail/constants';
import { renderForTestSend } from '@/lib/mail/render-for-send';
import { sendTestMail } from '@/lib/mail/send';
import { MailWrapper } from '@/lib/mail/template-wrapper';
import { getFirstContactSample } from '@/lib/operations/contact-sample.server';

import type {
  GetMailPreviewSampleInput,
  GetMailPreviewSampleOutput,
  SendTestTemplateMailInput,
  SendTestTemplateMailOutput,
} from '../../domain/mail-preview';

/**
 * 메일 템플릿 미리보기용 — 해당 설문의 첫 컨택 1건 샘플.
 * inviteUrl 은 NEXT_PUBLIC_APP_URL 기준으로 서버에서 빌드 (window.origin 사용 시
 * localhost 미리보기 / 실제 발송 도메인 불일치 문제 발생).
 * 컨택 0건이면 null.
 */
export async function getMailPreviewSample(
  input: GetMailPreviewSampleInput,
): Promise<GetMailPreviewSampleOutput> {
  const sample = await getFirstContactSample(input.surveyId);
  if (!sample) return null;

  const baseUrl = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, '');
  const inviteUrl = `${baseUrl}/survey/${input.surveyId}?invite=${sample.inviteToken}`;

  return {
    attrs: sample.attrs,
    inviteUrl,
    email: sample.email,
    resid: sample.resid,
  };
}

/**
 * 테스트 발송.
 * env 가드(RESEND_FROM_DOMAIN / NEXT_PUBLIC_APP_URL) 실패와 발송 실패는 throw 하지 않고
 * 결과객체({ok:false,error})로 흘려 UI 에 사용자 친화 메시지를 그대로 보존한다.
 * 테스트 발송은 항상 sandbox 토큰 — 진짜 컨택의 unsubscribeToken 누출 방지.
 */
export async function sendTestTemplateMail(
  input: SendTestTemplateMailInput,
): Promise<SendTestTemplateMailOutput> {
  const fromDomain = process.env['RESEND_FROM_DOMAIN'];
  if (!fromDomain) {
    return { ok: false, error: 'RESEND_FROM_DOMAIN 환경변수가 설정되지 않았습니다.' };
  }

  // 수신거부 링크 빌드 — NEXT_PUBLIC_APP_URL 가 없으면 절대 URL 이 되지 않아
  // 메일 클라이언트에서 클릭이 어디로 갈지 정의되지 않음. 명시적 에러로 차단.
  const baseUrl = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, '');
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
