import 'server-only';

import { after } from 'next/server';

import { flushAxiom, isAxiomEnabled } from './axiom';

/**
 * flush 전략 (근거: .scratch/logging-pino/assets/01)
 *
 * @axiomhq/js 는 배치를 백그라운드 타이머로 전송하는데, Vercel 은 응답 반환 후
 * 인스턴스를 freeze 하므로 명시 flush 없이는 유실된다. Next `after()` 는 응답 반환
 * 후 실행이 보장되는 유일한 공식 훅이다.
 *
 * - 요청 경로(RPC 핸들러·REST 라우트): scheduleLogFlush() — 응답 지연 없음.
 * - 장수 프로세스(Inngest 핸들러 종료 시·스크립트): await flushLogs().
 *
 * Axiom 미설정(현 운영 상태)이면 둘 다 no-op 이라 어디서든 무조건 불러도 된다.
 */

/** 요청 스코프에서 응답 후 flush 를 예약한다. 요청 스코프 밖이면 즉시 flush 로 폴백. */
export function scheduleLogFlush(): void {
  if (!isAxiomEnabled()) return;
  try {
    after(() => flushAxiom());
  } catch {
    // after() 는 요청 스코프 밖에서 throw — 스크립트 등에서는 fire-and-forget 폴백
    void flushAxiom();
  }
}

/** 배치 전송 완료까지 대기. Inngest 핸들러 종료 시·스크립트 마지막에 사용. */
export async function flushLogs(): Promise<void> {
  if (!isAxiomEnabled()) return;
  await flushAxiom();
}
