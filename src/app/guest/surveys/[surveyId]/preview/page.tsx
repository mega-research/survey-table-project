import { ClientPreviewScreen } from '@/app/_client-console/preview-screen';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';

interface Props {
  params: Promise<{ surveyId: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '설문 미리보기' };

/**
 * 설문지 미리보기 — 게스트 계정 입구. 본문은 클라이언트 링크 입구와 함께 쓴다
 * (`app/_client-console/preview-screen`, ADR-0029).
 *
 * 관문에 탭을 넘기지 않는다 — 미리보기는 화이트리스트 밖이라 부여된 설문이면 언제나 열린다.
 */
export default async function GuestSurveyPreviewPage({ params }: Props) {
  const { surveyId } = await params;
  await assertGuestSurveyPageAccess(surveyId);

  return <ClientPreviewScreen surveyId={surveyId} />;
}
