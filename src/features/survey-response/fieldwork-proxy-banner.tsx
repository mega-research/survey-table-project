'use client';

import { useEffect, useState } from 'react';

import type { FieldworkProxyContext } from '@/shared/contracts/workspace-io';
import { client } from '@/shared/lib/rpc';

/**
 * 대리 응답 배너 (.pen FLOW 10-3, 티켓 27).
 *
 * 실사가 조사 대상 화면의 「응답 대행」으로 들어오면 **응답 페이지 맨 위에 이 띠 하나만**
 * 붙는다. 그 아래는 응답자가 보는 화면과 글자 하나 다르지 않아야 한다 — 대행이 별도 화면이
 * 되면 실사가 응답자와 다른 것을 보게 되고, 그 순간 대행의 의미가 사라진다.
 *
 * **판정은 서버가 한다.** 이 컴포넌트는 `mode` 를 받아 그리기만 하고, 응답자에게는 언제나
 * `none` 이 와서 아무것도 그리지 않는다(응답자 화면 diff 0).
 */
export function FieldworkProxyBanner({
  surveyId,
  inviteToken,
  hinted,
}: {
  surveyId: string | null;
  inviteToken: string | null;
  /**
   * `?fw=1` 이 붙어 있는가 — **호출 여부만** 정한다(티켓 27).
   *
   * 이것이 없으면 초대 응답자 전원이 이 조회를 한 번씩 하게 되어 「응답자 화면 diff 0」이
   * 깨지고, `lookup` 레이트리밋 버킷을 재개 호출과 나눠 쓰게 된다. 힌트를 위조해도 얻는 것은
   * 없다 — 서버가 세션을 보고 `none` 을 준다.
   */
  hinted: boolean;
}) {
  // **TanStack Query 를 쓰지 않는다.** 응답 흐름 트리에는 QueryClientProvider 가 없다 —
  // 응답자 화면은 서버 상태 캐시가 필요 없는 pub 페이지다. 배너 하나 때문에 provider 를
  // 끼우면 「pub 경로 침습은 최소한」이 깨지고, 응답자 트리 전체의 렌더 비용이 늘어난다.
  const [data, setData] = useState<FieldworkProxyContext | null>(null);

  useEffect(() => {
    // 힌트가 없으면 응답자다 — 호출 자체를 하지 않는다(응답자 화면 diff 0).
    if (!hinted || surveyId === null || inviteToken === null) return;
    let cancelled = false;
    void client.surveyResponse.proxy
      .context({ surveyId, inviteToken })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      // 배너는 확인용 표시일 뿐이라 실패가 응답을 막아서는 안 된다. 강제는 서버가 한다.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hinted, surveyId, inviteToken]);

  if (!data || data.mode === 'none') return null;

  if (data.mode === 'blocked') {
    return (
      <div className="bg-[#7A1F1F] px-9 py-2.5 text-center">
        <span className="text-[12.5px] font-semibold text-white">
          이미 응답이 완료된 대상입니다 — 대행으로 열 수 없습니다
        </span>
      </div>
    );
  }

  const target = data.contactLabel
    ? `대상 ${data.resid} ${data.contactLabel}`
    : `대상 ${data.resid}`;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 bg-[#0D1B4C] px-9 py-2.5">
      <span className="text-[12.5px] font-semibold text-white">
        실사 대행 모드 — {data.fieldworkUserName}
        {data.orgName ? `(${data.orgName})` : ''} · {target}
      </span>
      <span className="text-[11.5px] text-white/60">
        저장되는 응답은 실사 계정으로 귀속 기록됩니다
      </span>
    </div>
  );
}
