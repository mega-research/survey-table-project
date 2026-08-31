import { redirect } from 'next/navigation';

import { assertFieldworkSurveyPageAccess } from '@/server/page-fieldwork-access';

interface Props {
  params: Promise<{ surveyId: string }>;
}

/**
 * 탭 없는 주소 — 첫 화면(조사 대상)으로 보낸다 (.pen FLOW 10-2 가 그 화면이다).
 *
 * 리다이렉트 **전에** 관문을 지난다. 지나지 않으면 초대되지 않은 설문 id 로도 조사 대상
 * 주소가 만들어지고, 거부는 거기서 나므로 사용자에게 한 단계 늦게 보인다.
 */
export default async function FieldworkSurveyIndexPage({ params }: Props) {
  const { surveyId } = await params;
  await assertFieldworkSurveyPageAccess(surveyId, 'operations.view');
  redirect(`/fieldwork/surveys/${surveyId}/contacts`);
}
