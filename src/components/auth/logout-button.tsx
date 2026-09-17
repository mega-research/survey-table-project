'use client';

import { useState } from 'react';

import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth/client';

interface Props {
  children?: React.ReactNode;
  /** true 이면 아이콘만 표시하는 컴팩트 버튼(size="icon" + title)으로 렌더링한다. */
  iconOnly?: boolean;
}

/**
 * 로그아웃 실행의 단일 출처 — 세션 종료 후 전체 리로드로 RSC 캐시/상태를 초기화한다.
 *
 * 아래 공용 버튼과 사이드바 하단 프로필(features/workspace/admin-shell)이 함께 쓴다 —
 * 흐름이 두 벌이 되면 한쪽만 고쳐지는 순간 로그아웃 의미론이 갈린다.
 */
export async function signOutToLogin(): Promise<void> {
  await authClient.signOut();
  window.location.assign('/admin/login');
}

/**
 * 세션 종료 후 로그인 페이지로 이동하는 공용 로그아웃 버튼.
 *
 * signOut 이 실패해도 버튼이 영구 비활성으로 굳지 않도록 finally 에서 잠금을 푼다.
 */
export function LogoutButton({ children, iconOnly = false }: Props) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogout() {
    setIsLoading(true);
    try {
      await signOutToLogin();
    } finally {
      setIsLoading(false);
    }
  }

  if (iconOnly) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="로그아웃"
        className="text-red-500 hover:bg-red-50 hover:text-red-600"
        onClick={handleLogout}
        disabled={isLoading}
      >
        <LogOut className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-red-600 hover:bg-red-50 hover:text-red-700"
      onClick={handleLogout}
      disabled={isLoading}
    >
      <LogOut className="mr-2 h-4 w-4" />
      {children ?? '로그아웃'}
    </Button>
  );
}
