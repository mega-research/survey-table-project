import 'server-only';

import { renderMailPreview, type PreviewResult, type PreviewSample } from './render-preview';

interface Input {
  surveyId: string;
  subject: string;
  bodyHtml: string;
  fromName: string;
  /** 첫 컨택 attrs 기반 — inviteUrl 은 무시하고 sandbox 로 강제 치환. */
  sample: PreviewSample | null;
}

/**
 * 테스트 발송용 변수 치환. 미리보기와 다른 두 가지:
 *   1. mode: 'send' → missing/empty 강조 span 대신 빈 문자열로 치환.
 *   2. invite_link 는 sandbox 토큰으로 강제 치환 → 진짜 inviteToken 누출/오발송 방지.
 *      ?invite=__test__ 는 유효 token 이 아니므로 응답 페이지가 익명 폴백으로 처리.
 */
export function renderForTestSend(input: Input): PreviewResult {
  const baseUrl = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, '');
  const sandboxInvite = `${baseUrl}/survey/${input.surveyId}?invite=__test__`;

  const sandboxSample: PreviewSample = input.sample
    ? { attrs: input.sample.attrs, email: input.sample.email, inviteUrl: sandboxInvite }
    : { attrs: {}, email: null, inviteUrl: sandboxInvite };

  return renderMailPreview({
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    fromName: input.fromName,
    sample: sandboxSample,
    mode: 'send',
  });
}

interface CampaignSendInput {
  subject: string;
  bodyHtml: string;
  fromName: string;
  contactAttrs: Record<string, string>;
  contactEmail: string | null;
  /** 실제 invite URL — baseUrl + /survey/{surveyId}?invite={inviteToken}. 호출자가 빌드해서 전달. */
  inviteUrl: string;
}

/**
 * 단체 메일(단체 발송) 본문 치환. test 와 달리:
 *   - invite_link 가 실제 컨택 inviteToken URL 로 치환됨 (sandbox 아님)
 *   - mode='send' 로 missing/empty 강조 없이 빈 문자열 치환
 *
 * 수신거부 링크는 본문이 아닌 MailWrapper footer 가 채우므로 여기서는 처리하지 않음.
 */
export function renderForCampaignSend(input: CampaignSendInput): PreviewResult {
  return renderMailPreview({
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    fromName: input.fromName,
    sample: {
      attrs: input.contactAttrs,
      email: input.contactEmail,
      inviteUrl: input.inviteUrl,
    },
    mode: 'send',
  });
}
