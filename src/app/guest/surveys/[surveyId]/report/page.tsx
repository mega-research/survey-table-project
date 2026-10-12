import {
  type ClientReportSearchParams,
  ClientReportScreen,
} from '@/app/_client-console/report-screen';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';

interface Props {
  params: Promise<{ surveyId: string }>;
  searchParams: Promise<ClientReportSearchParams>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '진척 보고' };

/**
 * 진척 보고 — 게스트 계정 입구. 본문은 클라이언트 링크 입구와 함께 쓴다
 * (`app/_client-console/report-screen`, ADR-0029).
 */
export default async function GuestReportPage({ params, searchParams }: Props) {
  const { surveyId } = await params;
  await assertGuestSurveyPageAccess(surveyId, 'progressReport');

  return <ClientReportScreen surveyId={surveyId} searchParams={await searchParams} />;
}
