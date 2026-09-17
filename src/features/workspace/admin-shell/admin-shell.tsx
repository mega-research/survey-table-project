'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';

import { SYSTEM_SCOPE, type TeamRole, type WorkScope } from '@/shared/contracts/workspace';
import { writeWorkScopeCookie } from '@/shared/lib/work-scope-cookie';
import { WorkScopeContext } from '@/shared/lib/work-scope-context';

import { Sidebar } from './sidebar';
import { isSidebarHiddenPath } from './sidebar-menu';

const COLLAPSE_STORAGE_KEY = 'admin-sidebar-collapsed';

// localStorage 는 React 상태 바깥의 외부 저장소라 useSyncExternalStore 로 읽는다
// (use-media-query 와 동일 패턴) — SSR 은 항상 펼침(false)을 반환하고, 클라이언트 mount 후
// 실제 저장값으로 교정되므로 useEffect 기반 setState 없이 hydration-safe 하다.
const collapseListeners = new Set<() => void>();

function readCollapsed(): boolean {
  return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
}

function getServerCollapsed(): boolean {
  return false;
}

function subscribeCollapsed(listener: () => void): () => void {
  collapseListeners.add(listener);
  return () => collapseListeners.delete(listener);
}

function persistCollapsed(next: boolean): void {
  window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
  collapseListeners.forEach((listener) => listener());
}

interface AdminShellProps {
  user: { id: string; name: string; isSuperadmin: boolean; image: string | null };
  /** 내 활성 소속(역할 포함) — 프로필 역할 라벨·팀장 지름길용. */
  memberships: { teamId: string; teamName: string; role: TeamRole }[];
  /** 스위처가 고를 수 있는 팀 — 내 소속. 슈퍼어드민은 전 활성 팀. */
  teams: { id: string; name: string }[];
  /** 레이아웃이 서버에서 해석한 초기 범위(server/work-scope) — 쿠키를 그대로 믿은 값이 아니다. */
  initialScope: WorkScope;
  children: React.ReactNode;
}

/**
 * admin 공통 셸 (.pen FLOW 6, 역할 모델 v2 티켓 08) — 좌측 네이비 사이드바 + 콘텐츠.
 *
 * 범위 전환은 여기서 한 번에 처리한다: 쿠키 기록(다음 하드 내비게이션의 출발점) →
 * 컨텍스트 갱신(화면 즉시 반영) → 설문 캐시 무효화(범위 간 캐시 재사용 금지) → RSC 갱신.
 */
export function AdminShell({ user, memberships, teams, initialScope, children }: AdminShellProps) {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, getServerCollapsed);
  const [scope, setScopeState] = useState<WorkScope>(initialScope);
  const queryClient = useQueryClient();
  const router = useRouter();
  // 편집기·운영 콘솔은 화면 폭을 전부 쓴다 — 셸이 클라이언트라 소프트 내비게이션에도 즉시 따라간다.
  const sidebarHidden = isSidebarHiddenPath(usePathname());

  const toggleCollapsed = useCallback(() => {
    persistCollapsed(!readCollapsed());
  }, []);

  const setScope = useCallback(
    (next: string) => {
      setScopeState(next === SYSTEM_SCOPE ? { kind: 'system' } : { kind: 'team', teamId: next });
      writeWorkScopeCookie(next);
      // 범위 간 캐시 재사용 금지(티켓 08) — 키에 범위가 들어 있어도, 같은 범위로 되돌아왔을 때
      // 다른 범위에서 벌어진 변경(복제·삭제)이 남아 보이지 않게 전부 stale 로 접는다.
      // 특정 키를 지목하지 않는 이유: 워크스페이스 전환은 화면 전체의 전제가 바뀌는 일이고,
      // 키 리터럴을 여기 복제하면(feature 간 import 금지) 키 개편 때 조용히 어긋난다.
      queryClient.invalidateQueries();
      router.refresh();
    },
    [queryClient, router],
  );

  // 셸은 이미 role 이 실린 멤버십을 받는다 — 카드가 팀장·팀원을 가르려면 그 값이 필요하다.
  const leaderTeamIds = useMemo(
    () => memberships.filter((m) => m.role === 'leader').map((m) => m.teamId),
    [memberships],
  );

  const contextValue = useMemo(
    () => ({
      scope,
      teams,
      canSeeSystemScope: user.isSuperadmin,
      isSuperadmin: user.isSuperadmin,
      currentUserId: user.id,
      leaderTeamIds,
      setScope,
    }),
    [scope, teams, user.isSuperadmin, user.id, leaderTeamIds, setScope],
  );

  return (
    <WorkScopeContext.Provider value={contextValue}>
      <div className="flex min-h-screen">
        {!sidebarHidden && (
          <Sidebar
            user={user}
            memberships={memberships}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
          />
        )}
        <main className="min-w-0 flex-1 bg-[#F9FAFB]">{children}</main>
      </div>
    </WorkScopeContext.Provider>
  );
}
