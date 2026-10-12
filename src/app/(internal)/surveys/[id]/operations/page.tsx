import { redirect } from 'next/navigation';

import { internalOperationsPaths } from '@/features/operations/operations-paths';
import { assertSurveyConsolePageAccess } from '@/server/page-survey-access';

/**
 * 탭 없는 주소 — 응답 현황으로 보낸다 (외주 링크·게스트·실사 콘솔과 같은 관례).
 *
 * 없으면 404 다. 이 주소는 화면이 만들지 않지만 사람은 만든다(주소창 편집·링크 잘라 붙이기).
 * 옛 `/admin/surveys/<id>/operations` 북마크도 접두가 걷히면 정확히 이 자리에 닿는다.
 * 목적지가 응답 현황인 것은 설문 카드가 운영 콘솔로 들어가는 탭이 그것이기 때문이다.
 *
 * 읽는 것이 없는데도 관문을 부른다 — 「모든 콘솔 페이지가 자기 관문을 진다」를 예외 없이
 * 두기 위해서다(형제 외주 링크 index 와 같다). 묻는 capability 는 도착할 화면의 것이다.
 */
interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OperationsIndex({ params }: PageProps) {
  const { id: surveyId } = await params;
  await assertSurveyConsolePageAccess(surveyId, 'operations.view');
  redirect(internalOperationsPaths(surveyId).overview);
}
