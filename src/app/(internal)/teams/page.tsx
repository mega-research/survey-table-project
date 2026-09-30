import { TeamListView } from '@/features/workspace/team-management/team-list-view';
import { requireSuperadminPage } from '@/lib/auth/require-admin-page';

/**
 * 팀 관리 (.pen FLOW 7-1) — 슈퍼어드민 전용.
 *
 * 조직 구조를 다루는 화면이라 팀장에게 열지 않는다(ADR-0008). 데이터를 주는
 * workspace.teams.list 도 superadmin 베이스라 두 경로의 권한 축이 같다 — 페이지는 열리는데
 * 데이터만 막히는 어긋남을 만들지 않는다.
 */
export default async function AdminTeamsPage() {
  await requireSuperadminPage();
  return <TeamListView />;
}
