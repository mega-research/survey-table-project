import { requireSurveyConsolePage } from '@/lib/auth/require-survey-console-page';
import { resolveGuestShare } from '@/server/fieldwork-share-scope';

import { renderAdminResponseScreen } from '../admin-response-screen';

interface PageProps {
  params: Promise<{ id: string; responseId: string }>;
  searchParams: Promise<{ idx?: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 조회' };

/**
 * 응답 조회 라우트 — 응답 수정 화면을 잠가 그린다(값을 바꿀 수 없고 저장이 없다).
 * 보기만 하는 게스트는 응답 조회를 허용한 grant(`allowResponseView`)만 연다. 수정 저장은 서버가
 * 따로 막는다(`assertSurveyWriteAccess`).
 */
export default async function AdminResponseViewPage({ params, searchParams }: PageProps) {
  const { id: surveyId, responseId } = await params;
  // 미들웨어를 통과한 무권한 세션을 거른다 — 이 설문에 접근할 수 있는 계정만.
  // 담당 범위에 묶인 게스트에게도 연다 — 범위 밖 응답은 없는 응답처럼 404 다.
  const user = await requireSurveyConsolePage(surveyId, { viewOnly: 'responseViewGrant', share: 'allow' });
  const share = resolveGuestShare(user.id, surveyId);
  const sp = await searchParams;
  const idxNum = sp.idx ? parseInt(sp.idx, 10) : NaN;
  const idx = Number.isFinite(idxNum) && idxNum > 0 ? idxNum : null;
  // 컴포넌트로 감싸지 않고 바로 부른다 — 페이지가 돌려주는 트리에 편집기가 그대로 보여야
  // 테스트가 넘어가는 props 를 읽는다(tests/integration/admin-response-edit-page.test.ts).
  return renderAdminResponseScreen({ surveyId, responseId, idx, readOnly: true, share });
}
