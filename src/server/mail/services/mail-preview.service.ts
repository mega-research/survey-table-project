import 'server-only';

import { createElement } from 'react';

import { render } from '@react-email/render';

import { db } from '@/db';
import { ensureImageLinkBandSlices } from './image-link-band-slices';
import { UNSUBSCRIBE_SANDBOX_TOKEN } from '@/lib/mail/constants';
import { extractMailContentKeys } from '@/server/storage-lifecycle/key-extract';
import { recordSentKeys } from '@/server/storage-lifecycle/sent-ledger.server';
import { renderForTestSend } from './render-for-send';
import { sendTestMail } from './send';
import { MailWrapper } from './template-wrapper';
import { buildInviteUrl } from '@/lib/survey-url';
import { getContactSampleById, getFirstContactSample } from '@/server/read-models/contact-sample.server';
import { loadOperationsDataScope } from '@/server/data-scope.server';

import type {
  GetMailPreviewSampleInput,
  GetMailPreviewSampleOutput,
  SendTestTemplateMailInput,
  SendTestTemplateMailOutput,
} from '../domain/mail-preview';

/**
 * 메일 템플릿 미리보기용 — 해당 설문의 첫 컨택 1건 샘플.
 * inviteUrl 은 NEXT_PUBLIC_APP_URL 기준으로 서버에서 빌드 (window.origin 사용 시
 * localhost 미리보기 / 실제 발송 도메인 불일치 문제 발생).
 * 컨택 0건이면 null.
 */
export async function getMailPreviewSample(
  input: GetMailPreviewSampleInput,
): Promise<GetMailPreviewSampleOutput> {
  const scope = await loadOperationsDataScope(input.surveyId);
  const sample = input.contactTargetId
    ? await getContactSampleById(input.surveyId, input.contactTargetId, scope)
    : await getFirstContactSample(input.surveyId, scope);
  if (!sample) return null;

  // inviteUrl 은 절대 URL 이어야 한다 — NEXT_PUBLIC_APP_URL 가 없으면 relative path 가 되어
  // 미리보기에서 끊긴 초대 링크를 조용히 노출한다. sendTestTemplateMail 과 동일하게 명시적 차단.
  const baseUrl = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL 환경변수가 설정되지 않았습니다.');
  }
  const inviteUrl = buildInviteUrl(sample.inviteCode, baseUrl);

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

  const scope = await loadOperationsDataScope(input.surveyId);
  const sample = await getFirstContactSample(input.surveyId, scope);

  // 테스트 발송은 미저장 초안(bodyHtml)을 그대로 받으므로, 클릭 영역이 있으면
  // 저장 전이라도 밴드 슬라이스를 여기서 생성한다 (키가 결정적이라 재실행 무해).
  let bodyHtml: string;
  try {
    bodyHtml = await ensureImageLinkBandSlices(input.bodyHtml);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : '클릭 영역 이미지 처리 중 오류가 발생했습니다.';
    return { ok: false, error: message };
  }

  // 발송 장부 기록 — 단건 테스트 발송도 발신 시점에 최종 본문(밴드 슬라이스
  // 반영분)+첨부의 R2 키를 기록한다. 기록 실패는 결과객체로 삼키지 않고 throw
  // 한다: 장부는 발송 파일 보호 장치라 기록 없이 발송하면 안 된다.
  // isTest "캠페인" 발송은 campaign-dispatch 의 prepare 경로에서 기록되므로
  // 여기서는 별도 처리가 불요하다. tmp/* 는 recordSentKeys 게이트가 거른다.
  await recordSentKeys(
    db,
    extractMailContentKeys({ bodyHtml, attachments: input.attachments }),
  );

  const rendered = renderForTestSend({
    surveyId: input.surveyId,
    subject: input.subject,
    bodyHtml,
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
      testFooterKind: 'template',
    }),
  );

  try {
    return await sendTestMail({
      to: input.to,
      subject: rendered.subject,
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
