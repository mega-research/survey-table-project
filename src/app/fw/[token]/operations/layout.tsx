import { OperationsPageHeader } from '@/features/operations/operations-page-header';
import { OperationsTabStrip } from '@/features/operations/operations-tab-strip';
import { fieldworkLinkOperationsBase } from '@/features/operations/operations-paths';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';
import { getSurveyById } from '@/server/survey-builder/services/survey-read';

import { LinkSignOutButton } from './link-sign-out-button';

/**
 * 외주 실사 링크 콘솔의 셸 — 깎인 헤더와 탭 (ADR-0026, .pen FLOW 10-4).
 *
 * **화면 정의는 `/admin` 과 한 벌이다.** 헤더와 탭 스트립은 같은 컴포넌트이고, 무엇이
 * 그려질지는 주입된 `capabilities` 와 `internalShell=false` 가 정한다. 그래서 여기에
 * 외주 전용 헤더를 새로 짜지 않는다 — 두 벌이 되면 한쪽만 고쳐진다.
 *
 * **외주임을 알리는 배지·배너를 두지 않는다**(ADR). 외주가 보는 것은 연구원이 설명하는
 * 화면과 같아야 하고, 「당신은 외부 인력」이라는 표시는 그 설명에 아무것도 더하지 않는다.
 *
 * 탭은 **판정 결과를 그대로** 받는다 — 현황·진척 보고·조사 대상 셋이다. 탭이 여는 주소는
 * 전부 이 트리 안에 실재해야 한다(「메뉴엔 있는데 누르면 404」가 예전 `isGuest` 불리언
 * 아래에서 실제로 있었던 회귀다). 그래서 leaf 셋이 이 셸과 같은 커밋에 선다.
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
    <div className="min-h-screen bg-gray-50">
      <OperationsPageHeader
        surveyId={surveyId}
        surveyTitle={survey?.title ?? ''}
        capabilities={capabilities}
        internalShell={false}
        trailing={<LinkSignOutButton token={token} />}
      />
      <OperationsTabStrip
        basePath={fieldworkLinkOperationsBase(token)}
        capabilities={capabilities}
        internalShell={false}
      />
      {children}
    </div>
  );
}
