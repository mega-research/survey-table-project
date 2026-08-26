import { SurveyListView } from '@/features/survey-builder/survey-list/survey-list-view';

/**
 * 설문 목록 (.pen FLOW 6, 역할 모델 v2 티켓 08).
 *
 * 서버 데이터는 읽지 않는다 — 목록은 클라이언트 뷰가 작업 범위 컨텍스트(AdminShell)와
 * RPC(read.list)로 가져오고, 인증·범위 판정은 레이아웃과 procedure(authed)가 한다.
 */
export default function SurveyListPage() {
  return <SurveyListView />;
}
