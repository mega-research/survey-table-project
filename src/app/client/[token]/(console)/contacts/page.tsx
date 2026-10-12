import { ClientContactsScreen } from '@/app/_client-console/contacts-screen';
import { GUEST_TAB_SEGMENT, guestConsoleHref } from '@/features/guest-console/guest-vocabulary';
import { clientLinkPath } from '@/lib/survey-url';
import { assertClientLinkPageAccess } from '@/server/page-client-link-access';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ page?: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '조사 대상' };

/**
 * 조사 대상(마스킹본) — 클라이언트 링크 입구. 본문은 게스트 계정 입구와 함께 쓴다
 * (`app/_client-console/contacts-screen`, ADR-0029).
 */
export default async function ClientLinkContactsPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { surveyId } = await assertClientLinkPageAccess(token, 'contactsMasked');

  return (
    <ClientContactsScreen
      surveyId={surveyId}
      basePath={guestConsoleHref(clientLinkPath(token), GUEST_TAB_SEGMENT.contactsMasked)}
      searchParams={await searchParams}
    />
  );
}
