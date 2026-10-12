'use client';

import { useState } from 'react';

import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { clientLinkPath } from '@/lib/survey-url';
import { client } from '@/shared/lib/rpc';

/**
 * 클라이언트 링크 콘솔의 「나가기」 — **그 링크의 쿠키 하나만** 지운다 (ADR-0029).
 *
 * 계정 로그아웃이 아니다. 클라이언트에게는 계정이 없고, 여러 조사의 링크를 한 브라우저에서
 * 여는 사람의 다른 조사 세션까지 끊으면 비밀번호를 다시 받아야 한다. 공용 PC 에서 자리를
 * 비울 때 쓰는 버튼이다.
 *
 * 외주 실사 링크의 버튼과 한 벌로 합치지 않은 것은 부르는 표면이 달라서다(`signOutClient` —
 * 쿠키의 경로가 다르다). 표면을 prop 으로 고르게 하면 「클라이언트 콘솔이 외주 쿠키를
 * 지우려 드는」 조합이 타입상 만들어지고, 그때 버튼은 눌리는데 세션은 그대로다.
 *
 * 이동이 전체 리로드인 것은 쿠키가 방금 사라졌고 그 상태로 RSC 를 다시 받아야 하기 때문이다.
 */
interface Props {
  token: string;
}

export function ClientLinkSignOutButton({ token }: Props) {
  const [isLeaving, setIsLeaving] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isLeaving}
      onClick={async () => {
        setIsLeaving(true);
        try {
          await client.workspace.accessLinkSession.signOutClient({ token });
        } finally {
          // 실패해도 입구로 보낸다 — 쿠키가 남아 있으면 입구가 다시 콘솔로 돌려보내므로
          // 사용자가 보는 결과는 「나가지지 않았다」이고, 그것이 조용한 실패보다 낫다.
          window.location.assign(clientLinkPath(encodeURIComponent(token)));
        }
      }}
    >
      <LogOut className="mr-2 h-4 w-4" />
      나가기
    </Button>
  );
}
