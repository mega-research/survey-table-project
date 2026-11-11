import 'server-only';

import { renderMailPreview, type PreviewResult, type PreviewSample } from '@/lib/mail/render-preview';
import { buildInviteUrl } from '@/lib/survey-url';

interface Input {
  surveyId: string;
  subject: string;
  bodyHtml: string;
  fromName: string;
  /** 첫 컨택 attrs 기반 — inviteUrl 은 무시한다(실제 대상자의 초대 링크를 테스트 수신자에게 보내지 않는다). */
  sample: PreviewSample | null;
  /**
   * 눌러서 열리는 **테스트 대상자** 초대 링크 — 테스트 모드가 켜진 설문의 첫 테스트 대상자 것
   * (`sendTestTemplateMail` 이 넘긴다). 없으면 견본 링크다.
   */
  testInviteUrl?: string | null;
}

/**
 * 테스트 발송용 변수 치환. 미리보기와 다른 두 가지:
 *   1. mode: 'send' → missing/empty 강조 span 대신 빈 문자열로 치환.
 *   2. invite_link 에 샘플(실제 대상자)의 초대 링크를 쓰지 않는다 → 진짜 inviteToken 누출/오발송 방지.
 *      - testInviteUrl 이 있으면 그 테스트 대상자 링크(눌러서 설문을 끝까지 테스트할 수 있다).
 *      - 없으면 견본 링크 /i/__test__ — 실제 컨택에 매칭되지 않아 클릭 시 not-found(초대 링크가
 *        유효하지 않음)로 처리된다.
 */
export function renderForTestSend(input: Input): PreviewResult {
  const baseUrl = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, '');
  const sandboxInvite = input.testInviteUrl || buildInviteUrl('__test__', baseUrl);

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
  /** 실제 invite URL — baseUrl + /i/{inviteCode}. 호출자가 buildInviteUrl 로 빌드해서 전달. */
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
