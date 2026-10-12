import { ClientQuotaScreen } from '@/app/_client-console/quota-screen';
import { assertClientLinkPageAccess } from '@/server/page-client-link-access';

interface Props {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '쿼터 현황' };

/**
 * 쿼터 현황 — 클라이언트 링크 입구. 본문은 게스트 계정 입구와 함께 쓴다
 * (`app/_client-console/quota-screen`, ADR-0029).
 */
export default async function ClientLinkQuotaPage({ params }: Props) {
  const { token } = await params;
  const { surveyId } = await assertClientLinkPageAccess(token, 'quota');

  return <ClientQuotaScreen surveyId={surveyId} />;
}
