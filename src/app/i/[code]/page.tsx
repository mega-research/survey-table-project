import { notFound } from 'next/navigation';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import { resolveInviteCode } from '@/features/contacts/server/services/contact-invite.service';

interface PageProps {
  params: Promise<{ code: string }>;
}

export default async function ShortInvitePage({ params }: PageProps) {
  const { code } = await params;
  const resolved = await resolveInviteCode(code);
  if (!resolved) notFound();

  return (
    <SurveyResponseFlow
      surveyIdentifier={resolved.accessIdentifier}
      inviteToken={resolved.inviteToken}
      testToken={null}
    />
  );
}
