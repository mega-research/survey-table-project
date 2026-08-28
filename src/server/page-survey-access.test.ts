import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RSC 페이지 관문 어댑터 (티켓 09·10).
 *
 * 페이지 표면은 거부 사유를 가르지 않는다 — 전부 notFound() 접기. 콘솔 페이지 관문
 * (assertSurveyConsolePageAccess)은 구 assertGuestSurveyPageAccess 의 게스트 판정에
 * 내부 계정 capability 판정을 더한 대체재라, 그 가드의 테스트를 여기가 승계한다.
 */

const { notFound, requireAuth } = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  requireAuth: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/lib/auth', () => ({ requireAuth }));
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
  assertSurveyCapabilityPage,
  assertSurveyConsolePageAccess,
} from './page-survey-access';

const SURVEY_ID = '11111111-2222-4333-8444-555555555555';
const internalViewer = {
  id: 'admin-1',
  isSuperadmin: false,
  userType: 'internal' as const,
};

describe('assertSurveyCapabilityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('관문을 통과하면 그대로 지나간다', async () => {
    vi.mocked(assertSurveyCapability).mockResolvedValue(undefined);
    await expect(
      assertSurveyCapabilityPage(internalViewer, SURVEY_ID, 'operations.view'),
    ).resolves.toBeUndefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it.each(['not_found', 'forbidden'] as const)(
    '%s 거부는 사유 불문 notFound 로 접는다',
    async (reason) => {
      vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new SurveyAccessError(reason));
      await expect(
        assertSurveyCapabilityPage(internalViewer, SURVEY_ID, 'contacts.view'),
      ).rejects.toThrow('NEXT_NOT_FOUND');
      expect(notFound).toHaveBeenCalledTimes(1);
    },
  );

  it('판정 이외의 예외는 그대로 던진다 — DB 장애를 404 로 접지 않는다', async () => {
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new Error('connection lost'));
    await expect(
      assertSurveyCapabilityPage(internalViewer, SURVEY_ID, 'survey.view'),
    ).rejects.toThrow('connection lost');
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe('assertSurveyConsolePageAccess — 게스트 허용 콘솔 페이지 관문 (티켓 10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('내부 계정은 capability 판정에 위임하고 viewer 를 돌려준다', async () => {
    requireAuth.mockResolvedValue(internalViewer);
    vi.mocked(assertSurveyCapability).mockResolvedValue(undefined);
    await expect(
      assertSurveyConsolePageAccess(SURVEY_ID, 'responses.view'),
    ).resolves.toBe(internalViewer);
    expect(assertSurveyCapability).toHaveBeenCalledWith(
      internalViewer,
      SURVEY_ID,
      'responses.view',
    );
  });

  it('내부 계정의 capability 거부는 notFound 로 접힌다 — 타 팀 설문 존재 은닉', async () => {
    requireAuth.mockResolvedValue(internalViewer);
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new SurveyAccessError('not_found'));
    await expect(
      assertSurveyConsolePageAccess(SURVEY_ID, 'contacts.view'),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  // 티켓 21 이 이 가드의 env grant 게스트 분기를 걷었다 — 게스트는 /admin 구역에 아예
  // 들어오지 못하고(레이아웃 유형 게이트) 자기 화면은 /guest 다.
  it('세션이 없으면 capability 판정까지 가지 않는다', async () => {
    requireAuth.mockRejectedValue(new Error('인증이 필요합니다.'));
    await expect(assertSurveyConsolePageAccess(SURVEY_ID, 'contacts.view')).rejects.toThrow(
      '인증이 필요합니다.',
    );
    expect(assertSurveyCapability).not.toHaveBeenCalled();
  });
});
