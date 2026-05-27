'use server';

import { headers } from 'next/headers';

import { computeSignals } from '@/lib/duplicate-detection/signals';
import { checkTrackA, checkTrackB } from '@/lib/duplicate-detection/check';
import type { ClientSignals, CheckResult } from '@/lib/duplicate-detection/types';

export async function checkDuplicateOnEntry(input: {
  surveyId: string;
  inviteToken?: string;
  // null 이면 클라이언트 신호 수집 실패 — Track B skip (통과 처리)
  clientSignals: ClientSignals | null;
}): Promise<CheckResult> {
  const { surveyId, inviteToken, clientSignals } = input;

  // Track A: invite_token 1순위 — headers() 호출 없이 단락
  if (inviteToken) {
    return checkTrackA(surveyId, inviteToken);
  }

  // Track B: 공개/비공개 신호 기반. 신호 없으면 검사 skip (수용된 trade-off)
  if (!clientSignals) {
    return { blocked: false };
  }

  const h = await headers();
  const signals = computeSignals(h as unknown as Headers, clientSignals);
  return checkTrackB({ surveyId, signals });
}
