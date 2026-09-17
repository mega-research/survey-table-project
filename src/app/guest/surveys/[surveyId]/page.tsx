import { redirect } from 'next/navigation';

import { firstGuestTabSegment, GUEST_PREVIEW_SEGMENT } from '@/features/guest-console/guest-vocabulary';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';

interface Props {
  params: Promise<{ surveyId: string }>;
}

export const dynamic = 'force-dynamic';

/**
 * 탭 없는 주소(`/guest/surveys/<id>`)의 착지점 — 첫 화면으로 보낸다.
 *
 * 없으면 404 다. 이 주소는 카드가 만들지 않지만 사람은 만든다(주소창 편집·링크 잘라 붙이기).
 * 「부여받은 설문인데 404」는 부여가 풀린 것처럼 읽히므로 자기 화면으로 정착시킨다.
 *
 * 목적지는 **허용 탭이 있으면 그 첫 탭, 없으면 미리보기**다 — 카드의 「현황 보기」와 같은
 * 규칙(`firstGuestTabSegment`)이라 두 입구가 같은 곳으로 간다.
 */
export default async function GuestSurveyIndexPage({ params }: Props) {
  const { surveyId } = await params;
  const { tabs } = await assertGuestSurveyPageAccess(surveyId);
  redirect(`/guest/surveys/${surveyId}/${firstGuestTabSegment(tabs) ?? GUEST_PREVIEW_SEGMENT}`);
}
