import { ClientContactsScreen } from '@/app/_client-console/contacts-screen';
import {
  GUEST_TAB_SEGMENT,
  guestAccountSurveyBase,
  guestConsoleHref,
} from '@/features/guest-console/guest-vocabulary';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';

interface Props {
  params: Promise<{ surveyId: string }>;
  searchParams: Promise<{ page?: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '조사 대상' };

/**
 * 조사 대상(마스킹본) — 게스트 계정 입구. 본문은 클라이언트 링크 입구와 함께 쓴다
 * (`app/_client-console/contacts-screen`, ADR-0029).
 */
export default async function GuestContactsPage({ params, searchParams }: Props) {
  const { surveyId } = await params;
  await assertGuestSurveyPageAccess(surveyId, 'contactsMasked');

  return (
    <ClientContactsScreen
      surveyId={surveyId}
      basePath={guestConsoleHref(guestAccountSurveyBase(surveyId), GUEST_TAB_SEGMENT.contactsMasked)}
      searchParams={await searchParams}
    />
  );
}
