import { requireSurveyConsolePage } from '@/lib/auth/require-survey-console-page';
import { resolveGuestShare } from '@/server/fieldwork-share-scope';

import { renderAdminResponseScreen } from '../admin-response-screen';

interface PageProps {
  params: Promise<{ id: string; responseId: string }>;
  searchParams: Promise<{ idx?: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 수정' };

/**
 * 어드민 응답 수정 라우트 — 본문은 응답 조회와 함께 쓰는 `AdminResponseScreen`.
 * 보기만 하는 게스트에게는 열지 않는다(응답 조회는 `../view`).
 */
export default async function AdminResponseEditPage({ params, searchParams }: PageProps) {
  const { id: surveyId, responseId } = await params;
  // 미들웨어를 통과한 무권한 세션을 거른다 — 이 설문에 접근할 수 있는 계정만.
  // 담당 범위에 묶인 게스트에게도 연다 — 범위 밖 응답은 없는 응답처럼 404 다.
  const user = await requireSurveyConsolePage(surveyId, { share: 'allow' });
  const share = resolveGuestShare(user.id, surveyId);
  const sp = await searchParams;
  const idxNum = sp.idx ? parseInt(sp.idx, 10) : NaN;
  const idx = Number.isFinite(idxNum) && idxNum > 0 ? idxNum : null;
  // 컴포넌트로 감싸지 않고 바로 부른다 — 페이지가 돌려주는 트리에 편집기가 그대로 보여야
  // 테스트가 넘어가는 props 를 읽는다(tests/integration/admin-response-edit-page.test.ts).
  return renderAdminResponseScreen({ surveyId, responseId, idx, readOnly: false, share });
}
