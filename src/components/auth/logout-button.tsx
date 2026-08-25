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
 * 세션 종료 후 로그인 페이지로 이동하는 공용 로그아웃 버튼.
 *
 * signOut 이 실패해도 버튼이 영구 비활성으로 굳지 않도록 finally 에서 잠금을 푼다.
 */
export function LogoutButton({ children, iconOnly = false }: Props) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogout() {
    setIsLoading(true);
    try {
      await authClient.signOut();
      // 전체 리로드로 RSC 캐시/상태를 초기화한다.
      window.location.assign('/admin/login');
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
