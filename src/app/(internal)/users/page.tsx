import { UserManagementView } from '@/features/workspace/user-management/user-management-view';
import { requireSuperadminPage } from '@/lib/auth/require-admin-page';

/**
 * 사용자 관리 (.pen FLOW 1-1) — 슈퍼어드민 전용.
 *
 * 레이아웃 가드는 소프트 내비게이션에서 다시 돌지 않으므로(티켓 02 기록) 이 페이지가
 * 직접 판정한다. 데이터를 주는 auth.users.* procedure 도 superadmin 베이스라 두 경로의
 * 권한 축이 같다.
 */
export default async function AdminUsersPage() {
  await requireSuperadminPage();
  return <UserManagementView />;
}
