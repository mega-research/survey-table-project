import { notFound } from 'next/navigation';

import { GuestSurveyHeader } from '@/features/guest-console/guest-survey-header';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';
import { getGuestSurveyCard } from '@/server/read-models/guest-surveys';

interface Props {
  params: Promise<{ surveyId: string }>;
  children: React.ReactNode;
}

/**
 * 게스트 열람 화면의 서브헤더 + 탭 (.pen FLOW 5-3, 역할 모델 v2 티켓 22).
 *
 * 레이아웃이 설문 관문을 **탭 없이** 한 번 지난다(부여됐는가까지). 탭 판정은 각 페이지가
 * 자기 탭으로 다시 한다 — 내부 콘솔의 `[id]` 레이아웃이 `survey.view` 를 접고 leaf 가 정밀
 * 관문을 갖는 것과 같은 구조다.
 *
 * 카드 머리(제목·기간·상태)는 홈과 **같은 read-model·같은 매핑**에서 가져온다(단건 짝
 * `getGuestSurveyCard`). 설문 행을 따로 읽으면 「홈에는 종료인데 열람 화면에는 진행중」 같은
 * 어긋남이 생긴다 — 상태 판정의 정본이 둘이 되기 때문이다.
 */
export default async function GuestSurveyLayout({ params, children }: Props) {
  const { surveyId } = await params;
  const { user, tabs } = await assertGuestSurveyPageAccess(surveyId);

  const card = await getGuestSurveyCard(user.id, surveyId);
  // 관문을 지났는데 목록에 없다면 그 사이 부여가 사라진 것이다 — 존재를 알리지 않는다.
  if (!card) notFound();

  return (
    <>
      <GuestSurveyHeader
        surveyId={surveyId}
        title={card.title}
        publishedAt={card.publishedAt}
        endDate={card.endDate}
        lifecycle={card.lifecycle}
        tabs={tabs}
      />
      {children}
    </>
  );
}
