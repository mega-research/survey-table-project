'use client';

import { useState } from 'react';

import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { client } from '@/shared/lib/rpc';

/**
 * 링크 콘솔의 「나가기」 — **그 링크의 쿠키 하나만** 지운다 (ADR-0026, 스토리 20).
 *
 * 계정 로그아웃과 다른 동작이라 `LogoutButton` 을 쓰지 않는다. 두 조사를 병행하는 브라우저
 * 에서 다른 조사의 세션까지 끊으면 그 사람은 비밀번호를 다시 받아야 한다 — 서버 표면
 * (`accessLinkSession.signOut`)이 토큰 하나만 받는 이유가 그것이고, 화면도 같은 단위다.
 *
 * 이동이 `router.push` 가 아니라 전체 리로드인 것은 쿠키가 방금 사라졌고 그 상태로 RSC 를
 * 다시 받아야 하기 때문이다(입구 화면의 성공 경로와 같은 선례).
 */
interface Props {
  token: string;
}

export function LinkSignOutButton({ token }: Props) {
  const [isLeaving, setIsLeaving] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isLeaving}
      onClick={async () => {
        setIsLeaving(true);
        try {
          await client.workspace.accessLinkSession.signOut({ token });
        } finally {
          // 실패해도 입구로 보낸다 — 쿠키가 남아 있으면 그 화면이 다시 콘솔로 돌려보내므로
          // 사용자가 보는 결과는 「나가지지 않았다」이고, 그것이 조용한 실패보다 낫다.
          window.location.assign(`/fw/${encodeURIComponent(token)}`);
        }
      }}
    >
      <LogOut className="mr-2 h-4 w-4" />
      나가기
    </Button>
  );
}
