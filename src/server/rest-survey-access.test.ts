import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('checkScopedSurveyCapabilityRest — 게스트 허용 REST 표면 (티켓 11)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('env grant 게스트는 grant 설문이면 capability 판정 없이 통과한다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    await expect(
      checkScopedSurveyCapabilityRest({ ...user, id: 'guest-1' }, SURVEY_ID, 'export.download'),
    ).resolves.toBeNull();
    expect(assertSurveyCapability).not.toHaveBeenCalled();
  });

  it('env grant 게스트는 grant 밖 설문이면 403 — 종전 판정 유지', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    const denied = await checkScopedSurveyCapabilityRest(
      { ...user, id: 'guest-1' },
      SURVEY_ID,
      'export.download',
    );
    expect(denied?.status).toBe(403);
    expect(assertSurveyCapability).not.toHaveBeenCalled();
  });

  it('grant 없는 내부 계정은 capability 관문에 위임한다', async () => {
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new SurveyAccessError('not_found'));
    const denied = await checkScopedSurveyCapabilityRest(user, SURVEY_ID, 'export.download');
    expect(denied?.status).toBe(404);
    expect(assertSurveyCapability).toHaveBeenCalledWith(user, SURVEY_ID, 'export.download');
  });
});
