import {
  ClientResponsesScreen,
  type ClientResponsesSearchParams,
} from '@/app/_client-console/responses-screen';
import {
  CLIENT_RESPONSES_EXPORT_SEGMENT,
  CLIENT_RESPONSES_SEGMENT,
  guestConsoleHref,
} from '@/features/guest-console/guest-vocabulary';
import { clientLinkPath } from '@/lib/survey-url';
import { assertClientLinkPageAccess } from '@/server/page-client-link-access';
import { isClientLinkTabOpen } from '@/shared/contracts/workspace';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<ClientResponsesSearchParams>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 내역' };

/**
 * 응답 내역 — 클라이언트 링크 입구 (`.scratch/client-link-response-list` 티켓 03). 관문이 「응답
 * 내역」 칩을 묻는다. 딸린 칩 둘(`.scratch/client-link-response-extras`)이 이 화면에 붙는다 —
 * 「응답 조회」면 행마다 하위 주소 `./<조회 키>`(조회 전용 — 응답 id 가 아니다)가, 「엑셀 다운로드」면 오른쪽 위 버튼
 * (`./export`)이 선다. 수정·삭제 주소는 없다.
 */
export default async function ClientLinkResponsesPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { surveyId, linkId, tabs } = await assertClientLinkPageAccess(token, 'responses');
  const basePath = guestConsoleHref(clientLinkPath(token), CLIENT_RESPONSES_SEGMENT);

  return (
    <ClientResponsesScreen
      surveyId={surveyId}
      basePath={basePath}
      searchParams={await searchParams}
      linkId={linkId}
      responseView={isClientLinkTabOpen(tabs, 'responseView')}
      {...(isClientLinkTabOpen(tabs, 'responsesExport')
        ? { exportHref: `${basePath}/${CLIENT_RESPONSES_EXPORT_SEGMENT}` }
        : {})}
    />
  );
}
