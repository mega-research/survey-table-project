import { QueryProvider } from '@/components/providers/query-provider';
import { OperationsPageHeader } from '@/features/operations/operations-page-header';
import {
  fieldworkLinkOperationsBase,
  fieldworkLinkPreviewPath,
} from '@/features/operations/operations-paths';
import { OperationsTabStrip } from '@/features/operations/operations-tab-strip';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';
import { getSurveyById } from '@/server/survey-builder/services/survey-read';

import { LinkSignOutButton } from './link-sign-out-button';

/**
 * 외주 실사 링크 콘솔의 셸 — 깎인 헤더와 탭 (ADR-0026, .pen FLOW 10-4).
 *
 * **화면 정의는 내부 콘솔과 한 벌이다.** 헤더와 탭 스트립은 같은 컴포넌트이고, 무엇이
 * 그려질지는 주입된 `capabilities` 와 `internalShell=false` 가 정한다. 그래서 여기에
 * 외주 전용 헤더를 새로 짜지 않는다 — 두 벌이 되면 한쪽만 고쳐진다.
 *
 * **외주임을 알리는 배지·배너를 두지 않는다**(ADR). 외주가 보는 것은 연구원이 설명하는
 * 화면과 같아야 하고, 「당신은 외부 인력」이라는 표시는 그 설명에 아무것도 더하지 않는다.
 *
 * 탭은 **판정 결과를 그대로** 받는다 — 현황·진척 보고·조사 대상 셋이다. 탭이 여는 주소는
 * 전부 이 트리 안에 실재해야 한다(「메뉴엔 있는데 누르면 404」가 예전 `isGuest` 불리언
 * 아래에서 실제로 있었던 회귀다). 그래서 leaf 셋이 이 셸과 같은 커밋에 선다.
 *
 * **QueryProvider 를 여기서 연다.** 루트가 아니라 `(internal)` 레이아웃만 여는데, 이 트리는
 * 그 밖에 있으면서 내부 콘솔과 같은 조사 대상 표를 그린다 — 표의 헤더 필터 팝오버가
 * `contacts.attrValues` 를 `useQuery` 로 당긴다(링크에게 열린 scoped 표면이다). 입구 화면
 * (비밀번호)은 Query 를 쓰지 않으므로 범위를 이 레이아웃으로 한정한다.
 */
interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}

export default async function FieldworkLinkOperationsLayout({ children, params }: LayoutProps) {
  const { token } = await params;
  // 트리 진입점에서 survey.view 를 한 번 접는다 — leaf 는 자기 정밀 관문을 따로 가진다.
  const { surveyId, capabilities } = await assertFieldworkLinkPageAccess(token, 'survey.view');
  // 관문이 지났으므로 설문은 살아 있다 — 제목만 쓴다.
  const survey = await getSurveyById(surveyId);

  return (
    <QueryProvider>
      <div className="min-h-screen bg-gray-50">
        <OperationsPageHeader
          surveyId={surveyId}
          surveyTitle={survey?.title ?? ''}
          capabilities={capabilities}
          internalShell={false}
          // 설문 보기는 admin 미리보기가 아니라 링크 트리의 열람 화면으로 간다(ADR-0027 이후).
          previewHref={fieldworkLinkPreviewPath(token)}
          trailing={<LinkSignOutButton token={token} />}
        />
        <OperationsTabStrip
          basePath={fieldworkLinkOperationsBase(token)}
          capabilities={capabilities}
          internalShell={false}
        />
        {children}
      </div>
    </QueryProvider>
  );
}
