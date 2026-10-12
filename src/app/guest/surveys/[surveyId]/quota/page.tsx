import { ClientQuotaScreen } from '@/app/_client-console/quota-screen';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';

interface Props {
  params: Promise<{ surveyId: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '쿼터 현황' };

/**
 * 쿼터 현황 — 게스트 계정 입구. 본문은 클라이언트 링크 입구와 함께 쓴다
 * (`app/_client-console/quota-screen`, ADR-0029).
 */
export default async function GuestQuotaPage({ params }: Props) {
  const { surveyId } = await params;
  await assertGuestSurveyPageAccess(surveyId, 'quota');

  return <ClientQuotaScreen surveyId={surveyId} />;
}
