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
      // 초대 코드를 풀면서 설문 id 를 이미 조회했다. 넘기지 않으면 클라이언트가
      // 슬러그·비공개 토큰으로 같은 답을 한 번 더 물어 왕복이 하나 늘어난다.
      resolvedSurveyId={resolved.surveyId}
      inviteToken={resolved.inviteToken}
      testToken={null}
    />
  );
}
