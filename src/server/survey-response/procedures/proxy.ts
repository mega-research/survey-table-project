import * as z from 'zod';

import { describeProxyTarget, resolveFieldworkProxy } from '@/server/fieldwork-proxy';
import { pub, withRateLimit } from '@/server/orpc';
import { FieldworkProxyContext } from '@/shared/contracts/workspace-io';

/**
 * 대리 응답 배너의 데이터 (.pen FLOW 10-3, 티켓 27).
 *
 * `pub` 인 이유는 응답 페이지 전체가 `pub` 이기 때문이다 — 이 표면 하나만 인증을 요구하면
 * 응답자 화면이 401 을 하나 물고 시작한다. 대신 **판정 자체가 인증이다**: 코어가 세션을 보고
 * 실사·초대·컨택 일치를 모두 확인한 뒤에만 값을 준다.
 *
 * 응답자에게는 언제나 `{ mode: 'none' }` 이고, 코어가 DB 를 치지 않으므로 이 호출은 사실상
 * 공짜다. 그 사실이 「응답자 화면 diff 0」을 지탱한다.
 */
const context = pub
  .use(withRateLimit('lookup'))
  .input(
    z.object({
      surveyId: z.string(),
      inviteToken: z.string().nullable(),
      /**
       * 레이트리밋의 **클라이언트 축** (orpc.ts `extractRateLimitClientId`).
       *
       * 판정에는 쓰지 않는다 — 넣는 이유는 이 표면이 `lookup` 버킷을 재개 호출과 나눠 쓰고,
       * 실사 사무실은 단일 NAT 라서다. 축이 없으면 IP 하나로 뭉뚱그려져 한 사무실의 여러
       * 실사원이 서로의 예산을 소진한다(2026-08-10 리미터 사고와 같은 모양).
       */
      sessionId: z.string(),
    }),
  )
  .output(FieldworkProxyContext)
  .handler(async ({ context: ctx, input }) => {
    const proxy = await resolveFieldworkProxy(ctx.user, input.surveyId, input.inviteToken);
    if (proxy.kind === 'none') return { mode: 'none' as const };
    if (proxy.kind === 'blocked') return { mode: 'blocked' as const };
    return {
      mode: 'proxy' as const,
      fieldworkUserName: proxy.fieldworkUserName,
      orgName: proxy.orgName,
      resid: proxy.resid,
      // 이름 복호는 **배너 표면에서만** 한다 — 귀속만 필요한 경로가 쓰지도 않을 PII 를
      // 복호하지 않게 코어에서 떼어냈다.
      contactLabel: await describeProxyTarget(proxy.contactTargetId, proxy.attrs),
    };
  });

export const proxy = { context };
