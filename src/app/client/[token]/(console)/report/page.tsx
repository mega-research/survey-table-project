import {
  type ClientReportSearchParams,
  ClientReportScreen,
} from '@/app/_client-console/report-screen';
import { assertClientLinkPageAccess } from '@/server/page-client-link-access';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<ClientReportSearchParams>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '진척 보고' };

/**
 * 진척 보고 — 클라이언트 링크 입구. 본문은 게스트 계정 입구와 함께 쓴다
 * (`app/_client-console/report-screen`, ADR-0029).
 */
export default async function ClientLinkReportPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { surveyId } = await assertClientLinkPageAccess(token, 'progressReport');

  return <ClientReportScreen surveyId={surveyId} searchParams={await searchParams} />;
}
