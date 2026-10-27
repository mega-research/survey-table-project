import {
  ClientResponsesScreen,
  type ClientResponsesSearchParams,
} from '@/app/_client-console/responses-screen';
import {
  CLIENT_RESPONSES_SEGMENT,
  guestConsoleHref,
} from '@/features/guest-console/guest-vocabulary';
import { clientLinkPath } from '@/lib/survey-url';
import { assertClientLinkPageAccess } from '@/server/page-client-link-access';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<ClientResponsesSearchParams>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 내역' };

/**
 * 응답 내역 — 클라이언트 링크 입구 (`.scratch/client-link-response-list` 티켓 03). 관문이 「응답
 * 내역」 칩을 묻는다. 하위 주소(상세·수정)는 없다 — 투영에 응답 id 가 없어 만들 수도 없다.
 */
export default async function ClientLinkResponsesPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { surveyId } = await assertClientLinkPageAccess(token, 'responses');

  return (
    <ClientResponsesScreen
      surveyId={surveyId}
      basePath={guestConsoleHref(clientLinkPath(token), CLIENT_RESPONSES_SEGMENT)}
      searchParams={await searchParams}
    />
  );
}
