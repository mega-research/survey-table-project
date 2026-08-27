import { SurveyReassignView } from '@/features/workspace/reassignment/survey-reassign-view';
import { requireSuperadminPage } from '@/lib/auth/require-admin-page';

/**
 * 단건 설문 재배치 (.pen FLOW 8-4) — 슈퍼어드민 전용.
 *
 * 설문 콘솔의 `[id]` 계열과 달리 capability 관문을 지나지 않는다. 배치 대기 설문은 팀이
 * 없어 `resolveSurveyCapabilities` 가 모두를 차단하기 때문이다(ADR-0006) — 관문을 걸면
 * 슈퍼어드민 자신도 못 열고, 관문을 통과시키려면 배치 대기 예외를 코어에 뚫어야 한다.
 * 대신 조회 자체를 배치 대기로 좁힌다: 서비스가 배치 대기가 아닌 설문에는 null 을 돌려주므로
 * 이 주소로 다른 설문의 존재를 확인할 수 없다.
 */
export default async function AdminSurveyReassignPage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  await requireSuperadminPage();
  const { surveyId } = await params;
  return <SurveyReassignView surveyId={surveyId} />;
}
