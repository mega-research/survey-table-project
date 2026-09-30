import { Suspense } from 'react';

import { SurveyListView } from '@/features/survey-builder/survey-list/survey-list-view';

/**
 * 설문 목록 (.pen FLOW 6, 역할 모델 v2 티켓 08).
 *
 * 서버 데이터는 읽지 않는다 — 목록은 클라이언트 뷰가 작업 범위 컨텍스트(AdminShell)와
 * RPC(read.list)로 가져오고, 인증·범위 판정은 레이아웃과 procedure(authed)가 한다.
 *
 * 뷰가 `?group=<id>`(그룹 화면, 티켓 12)를 useSearchParams 로 읽으므로 Suspense 경계가
 * 필요하다 — 없으면 프리렌더에서 트리 전체가 CSR 로 밀린다.
 */
export default function SurveyListPage() {
  return (
    <Suspense fallback={null}>
      <SurveyListView />
    </Suspense>
  );
}
