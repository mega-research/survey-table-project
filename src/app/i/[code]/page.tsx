import type { Metadata } from 'next';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import {
  InvalidInviteLinkScreen,
  InvalidTestLinkScreen,
} from '@/features/survey-response/survey-response-screens';
import { resolveInviteCode } from '@/server/contacts/services/contact-invite.service';

/**
 * 짧은 초대 링크도 공개 응답 표면이다 — 루트 layout 의 robots: 'index, follow' 를
 * 상속하지 않도록 noindex 로 덮는다 (/survey/[id]/layout.tsx, /preview/[token] 과 동일).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ code: string }>;
}

export default async function ShortInvitePage({ params }: PageProps) {
  const { code } = await params;
  const resolved = await resolveInviteCode(code);
  if (!resolved) return <InvalidInviteLinkScreen />;
  if (resolved.kind === 'invalid_test') return <InvalidTestLinkScreen />;

  return (
    <SurveyResponseFlow
      surveyIdentifier={resolved.accessIdentifier}
      inviteToken={resolved.inviteToken}
      testToken={null}
    />
  );
}
