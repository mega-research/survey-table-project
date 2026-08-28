import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * REST 관문 어댑터 (티켓 11).
 *
 * 거부 사유는 코어(survey-access 의 denialReasonFor)가 정하고 여기는 옮기기만 한다 —
 * not_found(없거나 볼 수 없음)→404 존재 은닉, forbidden(보이지만 권한 없음)→403.
 * scoped 짝의 게스트 분기는 rpc 어댑터(assertScopedSurveyCapabilityRpc)와 같은 정책이다.
 */

vi.mock('./survey-access', () => {
  class SurveyAccessError extends Error {
    constructor(public readonly reason: 'not_found' | 'forbidden') {
      super(reason);
      this.name = 'SurveyAccessError';
    }
  }
  return { SurveyAccessError, assertSurveyCapability: vi.fn() };
});

import { SurveyAccessError, assertSurveyCapability } from './survey-access';
import {
  checkScopedSurveyCapabilityRest,
  checkSurveyCapabilityRest,
} from './rest-survey-access';

const user = { id: 'u-1', isSuperadmin: false, userType: 'internal' as const };
const SURVEY_ID = '11111111-2222-4333-8444-555555555555';

describe('checkSurveyCapabilityRest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('관문을 통과하면 null 을 돌려준다', async () => {
    vi.mocked(assertSurveyCapability).mockResolvedValue(undefined);
    await expect(
      checkSurveyCapabilityRest(user, SURVEY_ID, 'export.download'),
    ).resolves.toBeNull();
    expect(assertSurveyCapability).toHaveBeenCalledWith(user, SURVEY_ID, 'export.download');
  });

  it('없거나 볼 수 없는 설문(not_found)은 404 응답 — 존재 은닉', async () => {
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new SurveyAccessError('not_found'));
    const denied = await checkSurveyCapabilityRest(user, SURVEY_ID, 'export.download');
    expect(denied?.status).toBe(404);
    await expect(denied?.json()).resolves.toEqual({ error: '설문을 찾을 수 없습니다.' });
  });

  it('보이지만 권한 없음(forbidden)은 403 응답', async () => {
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new SurveyAccessError('forbidden'));
    const denied = await checkSurveyCapabilityRest(user, SURVEY_ID, 'export.download');
    expect(denied?.status).toBe(403);
    await expect(denied?.json()).resolves.toEqual({ error: '권한이 없습니다.' });
  });

  it('판정 이외의 예외는 그대로 던진다 — DB 장애를 404 로 접지 않는다', async () => {
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new Error('connection lost'));
    await expect(
      checkSurveyCapabilityRest(user, SURVEY_ID, 'export.download'),
    ).rejects.toThrow('connection lost');
  });
});

describe('checkScopedSurveyCapabilityRest — export 3종의 문 (티켓 11·21)', () => {
  beforeEach(() => vi.clearAllMocks());

  // 티켓 11 은 게스트의 grant 설문 export 를 현행 유지로 남겨 뒀다(콘솔 다운로드 버튼이
  // 살아 있어서). 티켓 21 이 그 분기를 걷었다 — 스펙 §8 의 「게스트 export 항상 차단」이
  // 여기서 참이 된다.

  it('주체가 누구든 capability 관문에 위임한다', async () => {
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new SurveyAccessError('not_found'));
    const denied = await checkScopedSurveyCapabilityRest(user, SURVEY_ID, 'export.download');
    expect(denied?.status).toBe(404);
    expect(assertSurveyCapability).toHaveBeenCalledWith(user, SURVEY_ID, 'export.download');
  });

  it('게스트 계정에게 우회로가 남아 있지 않다', async () => {
    const guest = { ...user, id: 'guest-1', userType: 'guest' as const };
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new SurveyAccessError('forbidden'));
    const denied = await checkScopedSurveyCapabilityRest(guest, SURVEY_ID, 'export.download');
    expect(denied?.status).toBe(403);
    expect(assertSurveyCapability).toHaveBeenCalledWith(guest, SURVEY_ID, 'export.download');
  });
});
