import * as z from 'zod';

import { pub } from '@/server/orpc';

import {
  RecordStepVisitInput,
  RecordVisibilitySegmentInput,
  ResumeOrCreateResponseInput,
  ResumeOrCreateResponseOutput,
} from '../../domain/lifecycle';
import * as svc from '../services/lifecycle.service';

/**
 * 페이지 이동(스텝 전환) 기록(pub). 익명 응답자가 호출. 단일 UPDATE 멱등 처리.
 * 원본은 void 반환 — 소비처가 결과를 쓰지 않으므로 { ok: true } 로 래핑한다.
 */
const stepVisit = pub
  .input(RecordStepVisitInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.recordStepVisit(input);
    return { ok: true as const };
  });

/**
 * Page Visibility 세그먼트 기록(pub). sendBeacon 대상. status='in_progress' 가드.
 * 원본은 void 반환 — { ok: true } 로 래핑한다.
 */
const visibilitySegment = pub
  .input(RecordVisibilitySegmentInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.recordVisibilitySegment(input);
    return { ok: true as const };
  });

/**
 * 기존 응답 회복 또는 신규 진입 판별(pub). 매칭 행 없으면 null 반환.
 */
const resume = pub
  .input(ResumeOrCreateResponseInput)
  .output(ResumeOrCreateResponseOutput)
  .handler(({ input }) => svc.resumeOrCreateResponse(input));

export const lifecycle = {
  stepVisit,
  visibilitySegment,
  resume,
};
