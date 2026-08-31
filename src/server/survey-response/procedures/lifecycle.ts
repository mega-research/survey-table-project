import { ORPCError } from '@orpc/server';
import * as z from 'zod';

import { resolveFieldworkProxy } from '@/server/fieldwork-proxy';
import { pub, withRateLimit } from '@/server/orpc';

import {
  RecordStepVisitInput,
  RecordStepVisitOutput,
  RecordVisibilitySegmentInput,
  ResumeOrCreateResponseInput,
  ResumeOrCreateResponseOutput,
} from '../domain/lifecycle';
import * as svc from '../services/lifecycle';

// stepVisit/visibilitySegment 는 진행 중 응답에 빈번한 beacon 성 jsonb UPDATE 를 트리거한다.
// REST /api/response/segment 와 동일 서비스(recordVisibilitySegment)에 도달하므로,
// RPC 경로가 REST segment rate limit 을 우회하지 못하도록 동일 response-segment 그룹으로 한도를 건다.
const segmentRateLimited = pub.use(withRateLimit('response-segment'));

/**
 * 페이지 이동(스텝 전환) 기록(pub). 익명 응답자가 호출. 단일 UPDATE 멱등 처리.
 * 원본은 void 반환 — 소비처가 결과를 쓰지 않으므로 { ok: true } 로 래핑한다.
 */
const stepVisit = segmentRateLimited
  .input(RecordStepVisitInput)
  .output(RecordStepVisitOutput)
  .handler(async ({ input }) => {
    // 중단 판정은 던지지 않고 payload 로 싣는다 — 던지면 마스킹으로 사유가 소실되고
    // 중단 중 스텝 기록까지 멈춰 운영 콘솔 현황이 끊긴다.
    const { denial, pausedMessage } = await svc.recordStepVisit(input);
    return { ok: true as const, denial, pausedMessage };
  });

/**
 * Page Visibility 세그먼트 기록(pub). sendBeacon 대상. status='in_progress' 가드.
 * 원본은 void 반환 — { ok: true } 로 래핑한다.
 */
const visibilitySegment = segmentRateLimited
  .input(RecordVisibilitySegmentInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.recordVisibilitySegment(input);
    return { ok: true as const };
  });

/**
 * 기존 응답 회복 또는 신규 진입 판별(pub). 매칭 행 없으면 null 반환.
 * 진입 직후 호출되는 공개 조회/생성이므로 lookup 그룹으로 IP 당 rate limit 한다.
 */
const resume = pub
  .use(withRateLimit('lookup'))
  .input(ResumeOrCreateResponseInput)
  .output(ResumeOrCreateResponseOutput)
  .handler(async ({ context, input }) => {
    // 「이어서 대행」의 귀속 지점 (티켓 27). 재개는 INSERT 를 지나지 않으므로 생성 경로의
    // 짝이 여기 있어야 한다. 완료 대상 차단도 같은 코어가 준다.
    const proxy = await resolveFieldworkProxy(
      context.user,
      input.surveyId,
      input.inviteToken ?? null,
    );
    if (proxy.kind === 'blocked') {
      throw new ORPCError('FORBIDDEN', { message: '이미 응답이 완료된 대상입니다.' });
    }
    return svc.resumeOrCreateResponse(input, proxy.kind === 'proxy' ? proxy.fieldworkUserId : null);
  });

export const lifecycle = {
  stepVisit,
  visibilitySegment,
  resume,
};
