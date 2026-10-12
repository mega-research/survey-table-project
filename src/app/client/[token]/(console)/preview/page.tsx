import { ClientPreviewScreen } from '@/app/_client-console/preview-screen';
import { assertClientLinkPageAccess } from '@/server/page-client-link-access';

interface Props {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '설문 미리보기' };

/**
 * 설문지 미리보기 — 클라이언트 링크 입구. 본문은 게스트 계정 입구와 함께 쓴다
 * (`app/_client-console/preview-screen`, ADR-0029).
 *
 * 관문에 탭을 넘기지 않는다 — 미리보기는 화이트리스트 밖이라 링크가 열려 있으면 언제나 열린다.
 */
export default async function ClientLinkPreviewPage({ params }: Props) {
  const { token } = await params;
  const { surveyId } = await assertClientLinkPageAccess(token);

  return <ClientPreviewScreen surveyId={surveyId} />;
}
