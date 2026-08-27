import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RPC 관문 어댑터 (역할 모델 v2 티켓 09).
 *
 * 거부 사유는 코어(survey-access 의 denialReasonFor)가 정하고 여기는 옮기기만 한다 —
 * not_found(없거나 볼 수 없음)→NOT_FOUND, forbidden(보이지만 권한 없음)→FORBIDDEN.
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
  assertScopedSurveyCapabilityRpc,
  assertSurveyCapabilityRpc,
  toRpcSurveyAccessError,
} from './rpc-survey-access';

const user = { id: 'u-1', isSuperadmin: false, userType: 'internal' as const };
const SURVEY_ID = '11111111-2222-4333-8444-555555555555';

describe('assertSurveyCapabilityRpc', () => {
  beforeEach(() => vi.clearAllMocks());

  it('없거나 볼 수 없는 설문(not_found)은 NOT_FOUND 로 옮긴다 — 존재 은닉', async () => {
    vi.mocked(assertSurveyCapability).mockRejectedValue(new SurveyAccessError('not_found'));
    await expect(
      assertSurveyCapabilityRpc(user, SURVEY_ID, 'survey.edit'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('보이지만 권한 없음(forbidden)은 FORBIDDEN 으로 옮긴다', async () => {
    vi.mocked(assertSurveyCapability).mockRejectedValue(new SurveyAccessError('forbidden'));
    await expect(
      assertSurveyCapabilityRpc(user, SURVEY_ID, 'survey.publish'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('관문을 통과하면 그대로 지나간다', async () => {
    vi.mocked(assertSurveyCapability).mockResolvedValue(undefined);
    await expect(
      assertSurveyCapabilityRpc(user, SURVEY_ID, 'survey.edit'),
    ).resolves.toBeUndefined();
    expect(assertSurveyCapability).toHaveBeenCalledWith(user, SURVEY_ID, 'survey.edit');
  });

  it('판정 이외의 예외는 그대로 던진다 — DB 장애를 NOT_FOUND 로 접지 않는다', async () => {
    vi.mocked(assertSurveyCapability).mockRejectedValue(new Error('connection lost'));
    await expect(
      assertSurveyCapabilityRpc(user, SURVEY_ID, 'survey.view'),
    ).rejects.toThrow('connection lost');
  });
});

describe('assertScopedSurveyCapabilityRpc — 게스트 허용(scoped) 표면 (티켓 10)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('env grant 게스트는 grant 설문이면 capability 판정 없이 통과한다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    await expect(
      assertScopedSurveyCapabilityRpc(
        { ...user, id: 'guest-1' },
        SURVEY_ID,
        'contacts.manage',
      ),
    ).resolves.toBeUndefined();
    expect(assertSurveyCapability).not.toHaveBeenCalled();
  });

  it('env grant 게스트는 grant 밖 설문이면 FORBIDDEN — 종전 판정 유지', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    await expect(
      assertScopedSurveyCapabilityRpc({ ...user, id: 'guest-1' }, SURVEY_ID, 'contacts.view'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(assertSurveyCapability).not.toHaveBeenCalled();
  });

  it('grant 없는 내부 계정은 capability 관문에 위임한다', async () => {
    vi.mocked(assertSurveyCapability).mockResolvedValue(undefined);
    await expect(
      assertScopedSurveyCapabilityRpc(user, SURVEY_ID, 'mail.send'),
    ).resolves.toBeUndefined();
    expect(assertSurveyCapability).toHaveBeenCalledWith(user, SURVEY_ID, 'mail.send');
  });

  it('grant 없는 guest·fieldwork 유형 계정은 capability 거부가 NOT_FOUND 로 옮겨진다', async () => {
    // 유형별 기본 거부는 코어(resolveSurveyCapabilities 의 계정 유형 게이트)가 정한다 —
    // 여기서는 그 거부(not_found)가 RPC 어휘로 옮겨지는 것만 본다. 구 assertSurveyAccess
    // 의 FORBIDDEN 에서 존재 은닉(NOT_FOUND) 쪽으로 조정된 지점이다.
    vi.mocked(assertSurveyCapability).mockRejectedValue(new SurveyAccessError('not_found'));
    await expect(
      assertScopedSurveyCapabilityRpc(
        { id: 'guest-account', isSuperadmin: false, userType: 'guest' },
        SURVEY_ID,
        'contacts.view',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('toRpcSurveyAccessError', () => {
  it('SurveyAccessError 가 아니면 원본을 그대로 돌려준다', () => {
    const original = new Error('boom');
    expect(toRpcSurveyAccessError(original)).toBe(original);
  });

  it('사유별로 NOT_FOUND / FORBIDDEN 을 만든다', () => {
    expect(toRpcSurveyAccessError(new SurveyAccessError('not_found'))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(toRpcSurveyAccessError(new SurveyAccessError('forbidden'))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
