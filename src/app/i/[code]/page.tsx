import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import {
  InvalidInviteLinkScreen,
  InvalidTestLinkScreen,
} from '@/components/survey-response/survey-response-screens';
import { resolveInviteCode } from '@/features/contacts/server/services/contact-invite.service';

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
