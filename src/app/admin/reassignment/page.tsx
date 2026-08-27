import { ReassignmentView } from '@/features/workspace/reassignment/reassignment-view';
import { requireSuperadminPage } from '@/lib/auth/require-admin-page';

/**
 * 재배치 센터 (.pen FLOW 8-2·9-2) — 슈퍼어드민 전용.
 *
 * 팀장에게 열지 않는다. 여기 있는 사람과 설문은 **어느 팀에도 속하지 않는 것들**이라 팀
 * 경계로 좁힐 수 없고, 좁힐 수 없는 목록을 팀장에게 주면 그대로 전사 열람이 된다. 그래서
 * 주소에 teamId 를 받는 자리도 없다 — 딥링크로 남의 팀 인박스를 여는 모양 자체를 만들지 않는다.
 *
 * 데이터를 주는 workspace.reassignment.* 도 전부 superadmin 베이스라 두 경로의 권한 축이
 * 같다(팀 관리 페이지와 같은 관례).
 */
export default async function AdminReassignmentPage() {
  await requireSuperadminPage();
  return <ReassignmentView />;
}
