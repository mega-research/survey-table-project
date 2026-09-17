import { SurveyLoadingScreen } from '@/features/survey-response/survey-response-screens';

/**
 * 이 라우트의 서버 컴포넌트는 응답에 앞서 DB 를 조회한다. loading.tsx 가 없으면 그동안
 * 브라우저 기본 빈 화면이 보인다 — 조회가 끝난 뒤에야 첫 픽셀이 나오기 때문이다.
 * 응답 흐름이 로딩 중에 쓰는 것과 같은 화면을 먼저 스트리밍해 그 구간을 없앤다.
 */
export default function Loading() {
  return <SurveyLoadingScreen />;
}
