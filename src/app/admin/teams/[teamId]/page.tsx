import { TeamDetailView } from '@/features/workspace/team-management/team-detail-view';
import { requireAdminPage } from '@/lib/auth/require-admin-page';

/**
 * 팀 상세 (.pen FLOW 7-2) — 슈퍼어드민과 그 팀 소속.
 *
 * 목록(슈퍼어드민 전용)과 달리 팀장·팀원도 여는 화면이라 페이지 가드는 내부 계정까지만
 * 좁힌다. "이 팀 사람인가" 는 데이터를 주는 workspace.teams.detail 이 판정하고, 아니면
 * NOT_FOUND 를 돌려준다 — 남의 팀 id 를 찍어봐도 존재를 알 수 없다.
 */
export default async function AdminTeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  await requireAdminPage();
  const { teamId } = await params;
  return <TeamDetailView teamId={teamId} />;
}
