// 사이드바 메뉴 어휘 — 순수 판정 (역할 모델 v2 티켓 08).

import type { WorkScope } from '@/shared/contracts/workspace';

export type SidebarMenuItemId = 'surveys' | 'users' | 'teams' | 'profile';

/**
 * 사이드바 메뉴 항목을 순수 함수로 결정한다(단위 테스트를 위해 렌더링과 분리).
 *
 * - 팀 미배치(scope 'none') active 사용자: 「프로필」 단일 항목만 (.pen FLOW 9-1 제한 메뉴)
 *   — 설문 목록·사용자 관리·팀 관리는 전부 숨긴다. 서버도 같은 상태를 전부 차단하므로
 *   (티켓 07 capability 엔진) 메뉴는 그 사실의 표시일 뿐이다.
 * - 그 외: 「설문 목록」(전원) + 슈퍼어드민 한정 「사용자 관리」·「팀 관리」(.pen FLOW 7).
 *   프로필 진입은 메뉴가 아니라 하단 프로필 팝오버가 맡는다(.pen FLOW 3-2).
 *   (슈퍼어드민은 resolveWorkScopeFor 불변식상 'none' 이 되지 않는다.)
 */
export function getSidebarMenuItemIds(
  scopeKind: WorkScope['kind'],
  isSuperadmin: boolean,
): readonly SidebarMenuItemId[] {
  if (scopeKind === 'none') return ['profile'];
  return isSuperadmin ? ['surveys', 'users', 'teams'] : ['surveys'];
}
