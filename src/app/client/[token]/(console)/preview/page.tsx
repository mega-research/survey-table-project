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
 * 관문이 「설문 보기」 칩을 묻는다 — 끈 링크에서는 화면 머리의 버튼만 사라지는 것이 아니라 이
 * 주소도 404 다. 설문지를 보이지 않아야 하는 조사가 있다(리멤버 패널, 2026-10-27).
 */
export default async function ClientLinkPreviewPage({ params }: Props) {
  const { token } = await params;
  const { surveyId } = await assertClientLinkPageAccess(token, 'preview');

  return <ClientPreviewScreen surveyId={surveyId} />;
}
