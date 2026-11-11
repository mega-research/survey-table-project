import 'server-only';

import { createElement } from 'react';

import { render } from '@react-email/render';

import { db } from '@/db';
import { ensureImageLinkBandSlices } from './image-link-band-slices';
import { UNSUBSCRIBE_SANDBOX_TOKEN } from '@/lib/mail/constants';
import { extractMailContentKeys } from '@/server/storage-lifecycle/key-extract';
import { recordSentKeys } from '@/server/storage-lifecycle/sent-ledger';
import { renderForTestSend } from './render-for-send';
import { sendTestMail } from './send';
import { MailWrapper } from './template-wrapper';
import { buildInviteUrl } from '@/lib/survey-url';
import {
  getContactSampleById,
  getFirstContactSample,
  getFirstTestTargetSample,
} from '@/server/read-models/contact-sample';
import { loadOperationsDataScope } from '@/server/data-scope';
import { InternalFailure } from '@/server/internal-failure';

import type {
  GetMailPreviewSampleInput,
  GetMailPreviewSampleOutput,
  SendTestTemplateMailInput,
  SendTestTemplateMailOutput,
} from '../domain/mail-preview';

/**
 * 템플릿 미리보기·테스트 발송이 쓰는 **테스트 조사 대상자** — 설문의 테스트 모드가 켜져 있으면 첫 테스트
 * 대상자, 아니면 null(CONTEXT.md 「테스트 발송」). 게스트는 늘 실데이터라 쓰지 않는다.
 */
async function loadTestLinkSample(surveyId: string, isGuest: boolean | undefined) {
  return isGuest ? null : getFirstTestTargetSample(surveyId);
}

/**
 * 메일 템플릿 미리보기용 — 해당 설문의 컨택 1건 샘플.
 * - 테스트 모드가 켜져 있고 테스트 대상자가 있으면 **첫 테스트 대상자**(이 브라우저가 실데이터를 보는 중이어도).
 *   화면에 보이는 초대 링크를 눌러도 실제 응답이 생기지 않고, 테스트 발송이 보내는 것과 같은 값이다.
 * - 아니면 이 브라우저가 보는 파티션의 첫 컨택. contactTargetId 를 주면(단건 발송 미리보기) 그 컨택.
 * inviteUrl 은 NEXT_PUBLIC_APP_URL 기준으로 서버에서 빌드 (window.origin 사용 시
 * localhost 미리보기 / 실제 발송 도메인 불일치 문제 발생).
 * 컨택 0건이면 null.
 */
export async function getMailPreviewSample(
  input: GetMailPreviewSampleInput,
  opts: { isGuest?: boolean | undefined } = {},
): Promise<GetMailPreviewSampleOutput> {
  const testTarget = input.contactTargetId
    ? null
    : await loadTestLinkSample(input.surveyId, opts.isGuest);
  let sample = testTarget;
  if (!sample) {
    const scope = await loadOperationsDataScope(input.surveyId);
    sample = input.contactTargetId
      ? await getContactSampleById(input.surveyId, input.contactTargetId, scope)
      : await getFirstContactSample(input.surveyId, scope);
  }
  if (!sample) return null;

  // inviteUrl 은 절대 URL 이어야 한다 — NEXT_PUBLIC_APP_URL 가 없으면 relative path 가 되어
  // 미리보기에서 끊긴 초대 링크를 조용히 노출한다. sendTestTemplateMail 과 동일하게 명시적 차단.
  const baseUrl = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new InternalFailure('NEXT_PUBLIC_APP_URL 환경변수가 설정되지 않았습니다.');
  }
  const inviteUrl = buildInviteUrl(sample.inviteCode, baseUrl);

  return {
    attrs: sample.attrs,
    inviteUrl,
    email: sample.email,
    resid: sample.resid,
    ...(testTarget ? { isTest: true } : {}),
  };
}

/**
 * 테스트 발송.
 * env 가드(RESEND_FROM_DOMAIN / NEXT_PUBLIC_APP_URL) 실패와 발송 실패는 throw 하지 않고
 * 결과객체({ok:false,error})로 흘려 UI 에 사용자 친화 메시지를 그대로 보존한다.
 * 수신거부는 항상 sandbox 토큰 — 진짜 컨택의 unsubscribeToken 누출 방지.
 *
 * 테스트 모드가 켜져 있고 테스트 대상자가 있으면 **첫 테스트 대상자**의 값으로 본문을 채우고 그 대상자의
 * 초대 링크(눌러서 열리는 테스트 링크)를 넣는다. 아니면 이 브라우저가 보는 파티션의 첫 컨택 값 + 견본 링크다.
 * **실제 조사 대상의 초대 링크는 어떤 경우에도 넣지 않는다.** 성공 결과의 `inviteLink` 가 어느 쪽이었는지 알린다.
 */
export async function sendTestTemplateMail(
  input: SendTestTemplateMailInput,
  opts: { isGuest?: boolean | undefined } = {},
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

  const testTarget = await loadTestLinkSample(input.surveyId, opts.isGuest);
  const sample =
    testTarget ??
    (await getFirstContactSample(input.surveyId, await loadOperationsDataScope(input.surveyId)));

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
    testInviteUrl: testTarget ? buildInviteUrl(testTarget.inviteCode, baseUrl) : null,
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
    const result = await sendTestMail({
      to: input.to,
      subject: rendered.subject,
      fromName: rendered.fromName,
      fromLocal: input.fromLocal,
      fromDomain,
      replyTo: input.replyTo,
      html,
      attachments: input.attachments,
    });
    return result.ok
      ? { ...result, inviteLink: testTarget ? ('live' as const) : ('sandbox' as const) }
      : result;
  } catch (err) {
    const message = err instanceof Error ? err.message : '메일 발송 중 오류가 발생했습니다.';
    return { ok: false, error: message };
  }
}
