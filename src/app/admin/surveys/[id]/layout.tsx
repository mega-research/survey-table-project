import { assertGuestSurveyPageAccess } from '@/lib/auth/guest-page-guard';

interface SurveyAdminLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * /admin/surveys/[id]/* 공용 레이아웃.
 *
 * 렌더는 pass-through 다 — 자식 페이지들이 각자 nav 헤더와 (operations 의 경우) 탭 스트립을
 * 직접 그린다. 대신 **설문 경계 가드**가 여기 산다: 이 레이아웃은 [id] 가 바뀔 때마다 반드시
 * 다시 도는 유일한 자리라, 소프트 내비게이션으로 다른 설문 콘솔에 들어가는 게스트를 막는다
 * (admin 레이아웃의 경로 가드는 공통 세그먼트라 소프트 내비게이션에서 재실행되지 않는다).
 */
export default async function SurveyAdminLayout({ children, params }: SurveyAdminLayoutProps) {
  const { id } = await params;
  await assertGuestSurveyPageAccess(id);
  return <>{children}</>;
}
