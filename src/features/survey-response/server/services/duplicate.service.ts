import 'server-only';

import { headers } from 'next/headers';

import { checkTrackA, checkTrackB } from '@/lib/duplicate-detection/check';
import { computeSignals } from '@/lib/duplicate-detection/signals';

import type {
  CheckDuplicateOnEntryInput,
  CheckResultOutput,
} from '../../domain/duplicate';

/**
 * 진입 시 중복 감지(pub). 응답자가 페이지 진입 직후 1회 호출.
 *
 * - Track A: invite_token 1순위 — headers() 호출 없이 단락
 * - Track B: 공개/비공개 신호 기반. 신호 없으면 검사 skip (수용된 trade-off)
 *
 * headers() 호출 위치 보존(불변식 C): oRPC handler 는 Next route handler 의 요청
 * 스코프에서 실행되므로, server action 과 동일하게 headers() 가 동작한다.
 */
export async function checkDuplicateOnEntry(
  input: CheckDuplicateOnEntryInput,
): Promise<CheckResultOutput> {
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
