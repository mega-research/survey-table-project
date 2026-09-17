import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('assertScopedSurveyCapabilityRpc — 비내부 계정도 지나는 표면 (티켓 10·21)', () => {
  beforeEach(() => vi.clearAllMocks());

  // 티켓 21 이 이 어댑터의 게스트 분기를 걷었다 — 게스트가 env 설정이 아니라 계정 유형이
  // 되면서 자격 판정이 코어로 옮겨갔다. 그래서 이 함수에 남은 계약은 「예외 없이 코어에
  // 위임한다」 하나뿐이고, 그것이 곧 「부여 여부와 무관하게 게스트는 이 문에서 막힌다」다.

  it('주체가 누구든 코어 판정에 그대로 위임한다', async () => {
    vi.mocked(assertSurveyCapability).mockResolvedValue(undefined);
    await expect(
      assertScopedSurveyCapabilityRpc(user, SURVEY_ID, 'mail.send'),
    ).resolves.toBeUndefined();
    expect(assertSurveyCapability).toHaveBeenCalledWith(user, SURVEY_ID, 'mail.send');
  });

  it('게스트 계정도 예외 없이 코어를 지난다 — 우회 분기가 남아 있지 않다', async () => {
    const guest = { id: 'guest-account', isSuperadmin: false, userType: 'guest' as const };
    vi.mocked(assertSurveyCapability).mockRejectedValue(new SurveyAccessError('forbidden'));
    await expect(
      assertScopedSurveyCapabilityRpc(guest, SURVEY_ID, 'contacts.manage'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(assertSurveyCapability).toHaveBeenCalledWith(guest, SURVEY_ID, 'contacts.manage');
  });

  it('코어가 not_found 를 주면 존재 은닉(NOT_FOUND)으로 옮겨진다', async () => {
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
