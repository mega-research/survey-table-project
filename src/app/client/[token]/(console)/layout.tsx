import { notFound } from 'next/navigation';

import { GuestTabStrip } from '@/features/guest-console/guest-tab-strip';
import {
  GUEST_PREVIEW_SEGMENT,
  GUEST_SURVEY_LIFECYCLE_LABEL,
  guestConsoleHref,
  guestPeriodLabel,
} from '@/features/guest-console/guest-vocabulary';
import { OperationsPageHeader } from '@/features/operations/operations-page-header';
import { clientLinkPath } from '@/lib/survey-url';
import { assertClientLinkPageAccess } from '@/server/page-client-link-access';
import { hasQuotaPlan } from '@/server/quota/services/quota-status';
import { getClientSurveyHeader } from '@/server/read-models/guest-surveys';
import type { SurveyCapability } from '@/shared/contracts/workspace';

import { ClientLinkSignOutButton } from './client-link-sign-out-button';

/**
 * 화면 머리에 넘기는 capability — **비어 있다.**
 *
 * 운영 콘솔 헤더가 이 집합으로 묻는 것은 `survey.edit` 하나(중단·종료·테스트 모드·설문 편집
 * 버튼)이고, 클라이언트 링크의 열(`survey.view`·`operations.view`)에는 그것이 없다. 관문이
 * 돌려주는 것은 탭 화이트리스트라 여기서 열을 다시 읽지 않고, 「편집 계열은 아무것도 그리지
 * 않는다」를 빈 집합으로 말한다.
 */
const NO_EDIT_CAPABILITIES: ReadonlySet<SurveyCapability> = new Set();

interface Props {
  params: Promise<{ token: string }>;
  children: React.ReactNode;
}

/**
 * 클라이언트 링크 콘솔의 셸 — 화면 머리 + 탭 줄 (ADR-0029).
 *
 * **얼굴은 운영 콘솔과 한 벌이다.** 화면 머리는 내부 콘솔·외주 링크 콘솔과 같은
 * `OperationsPageHeader` 이고(`internalShell=false`), 거기 서는 것은 셋뿐이다 — 새로고침 ·
 * 설문 보기 · 나가기. 예전에는 게스트 계정 콘솔의 조각(로고 헤더바 + 서브헤더)을 썼는데,
 * 연구원이 보는 화면과 생김새가 달라 같은 숫자를 놓고도 다른 제품처럼 보였다.
 *
 * 탭 줄만 따로다(`GuestTabStrip`). 탭을 여는 축이 capability 가 아니라 연구원이 켠 화이트리스트
 * 라서 운영 콘솔의 탭 스트립을 그대로 쓸 수 없다 — 모양은 같고 판정만 이쪽 것이다. 설문
 * 미리보기는 탭이 아니라 화면 머리의 「설문 보기」가 연다(운영 콘솔과 같은 자리). 쿼터 현황 탭은
 * 칩이 켜져 있어도 **쿼터가 있는 설문에서만** 선다.
 *
 * 목록·홈으로 가는 길이 없다 — 링크는 설문 하나만 연다. 조사 기간과 진행 상태는 탭 줄 오른쪽에
 * 한 줄로 선다: 중단된 설문도 이 링크로는 열리므로 「지금 멈춰 있다」를 화면이 말해야 한다.
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
 * 않는다). 브라우저가 부르는 것은 「나가기」의 세션 표면 하나뿐이고, 새로고침은 RSC 를 다시
 * 받는 일이라 RPC 가 아니다.
 */
export default async function ClientLinkConsoleLayout({ params, children }: Props) {
  const { token } = await params;
  const { surveyId, tabs } = await assertClientLinkPageAccess(token);

  const [header, hasQuota] = await Promise.all([
    getClientSurveyHeader(surveyId),
    hasQuotaPlan(surveyId),
  ]);
  // 관문을 지났는데 머리를 못 읽었다면 그 사이 설문이 닫힌 것이다 — 존재를 알리지 않는다.
  if (!header) notFound();

  const basePath = clientLinkPath(token);
  return (
    <div className="min-h-screen bg-gray-50">
      <OperationsPageHeader
        surveyId={surveyId}
        surveyTitle={header.title}
        capabilities={NO_EDIT_CAPABILITIES}
        internalShell={false}
        previewHref={guestConsoleHref(basePath, GUEST_PREVIEW_SEGMENT)}
        trailing={<ClientLinkSignOutButton token={token} />}
      />
      <GuestTabStrip
        basePath={basePath}
        // 쿼터 현황 칩이 켜져 있어도 쿼터가 없는 설문에서는 탭을 세우지 않는다 — 눌러도 빈
        // 안내뿐이다(외주 링크 콘솔과 같은 규칙). 감추는 것은 **탭 줄뿐**이고 화이트리스트와
        // 관문은 그대로다: 연구원이 쿼터를 설정하면 칩을 다시 만지지 않아도 탭이 선다.
        tabs={{ ...tabs, quota: tabs.quota && hasQuota }}
        meta={`${guestPeriodLabel(header.publishedAt, header.endDate)} · ${GUEST_SURVEY_LIFECYCLE_LABEL[header.lifecycle]}`}
      />
      {children}
    </div>
  );
}
