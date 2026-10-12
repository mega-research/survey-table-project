import { notFound } from 'next/navigation';

import { GuestShell } from '@/features/guest-console/guest-shell';
import { GuestSurveyHeader } from '@/features/guest-console/guest-survey-header';
import { clientLinkPath } from '@/lib/survey-url';
import { assertClientLinkPageAccess } from '@/server/page-client-link-access';
import { getClientSurveyHeader } from '@/server/read-models/guest-surveys';

import { ClientLinkSignOutButton } from './client-link-sign-out-button';

interface Props {
  params: Promise<{ token: string }>;
  children: React.ReactNode;
}

/**
 * 클라이언트 링크 콘솔의 셸 — 헤더바 + 화면 머리 + 탭 (ADR-0029, .pen FLOW 5-3).
 *
 * **게스트 계정 입구와 같은 조각을 쓴다**(`GuestShell`·`GuestSurveyHeader`). 다른 것은 입구가
 * 넣는 값뿐이다 — 홈과 「목록으로」가 없고(링크는 설문 하나만 연다), 오른쪽 자리에 프로필
 * 메뉴 대신 「나가기」가 선다.
 *
 * 라우트 그룹 `(console)` 인 이유는 입구 화면(`../page.tsx`, 비밀번호 한 칸) 때문이다. 그
 * 화면은 조사 이름을 받지 않는 것이 계약인데, 이 레이아웃이 한 단계 위에 서면 비밀번호를
 * 넣기 전 화면에 조사 이름이 그려진다.
 *
 * 레이아웃은 관문을 **탭 없이** 한 번 지난다(링크가 열려 있는가까지). 탭 판정은 각 페이지가
 * 자기 탭으로 다시 한다 — App Router 는 소프트 내비게이션에서 레이아웃을 다시 돌리지 않는다.
 *
 * **QueryProvider 를 열지 않는다.** 이 트리의 클라이언트 조각은 전부 서버가 넘긴 props 만
 * 그린다 — 클라이언트 링크에게는 조회할 RPC 표면이 하나도 없다(쿠키가 RPC 주소에 실리지도
 * 않는다). 브라우저가 부르는 것은 「나가기」의 세션 표면 하나뿐이다.
 */
export default async function ClientLinkConsoleLayout({ params, children }: Props) {
  const { token } = await params;
  const { surveyId, tabs } = await assertClientLinkPageAccess(token);

  const header = await getClientSurveyHeader(surveyId);
  // 관문을 지났는데 머리를 못 읽었다면 그 사이 설문이 닫힌 것이다 — 존재를 알리지 않는다.
  if (!header) notFound();

  return (
    <GuestShell homeHref={null} trailing={<ClientLinkSignOutButton token={token} />}>
      <GuestSurveyHeader
        basePath={clientLinkPath(token)}
        backHref={null}
        title={header.title}
        publishedAt={header.publishedAt}
        endDate={header.endDate}
        lifecycle={header.lifecycle}
        tabs={tabs}
      />
      {children}
    </GuestShell>
  );
}
