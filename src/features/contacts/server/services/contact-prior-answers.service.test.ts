import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectChain = vi.fn();

vi.mock('@/db', () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: async () => selectChain(),
      };
      return chain;
    },
  },
}));

import { lookupPriorAnswers } from './contact-prior-answers.service';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const INVITE = '22222222-2222-4222-8222-222222222222';

describe('lookupPriorAnswers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectChain.mockResolvedValue([]);
  });

  it('무효(비-UUID) 토큰은 조회 없이 null 로 흡수한다', async () => {
    expect(await lookupPriorAnswers({ surveyId: SURVEY_ID, inviteToken: 'nope' })).toBeNull();
    expect(selectChain).not.toHaveBeenCalled();
  });

  it('매칭 행이 없으면 null', async () => {
    selectChain.mockResolvedValue([]);
    expect(await lookupPriorAnswers({ surveyId: SURVEY_ID, inviteToken: INVITE })).toBeNull();
  });

  it('이월 응답을 정규화해 돌려준다', async () => {
    selectChain.mockResolvedValue([
      { answers: { q1: '작년 답' }, isTest: false, testModeEnabled: false },
    ]);
    expect(await lookupPriorAnswers({ surveyId: SURVEY_ID, inviteToken: INVITE })).toEqual({
      q1: '작년 답',
    });
  });

  it('테스트 모드가 꺼진 테스트 대상자에게는 이월 응답을 내주지 않는다', async () => {
    selectChain.mockResolvedValue([
      { answers: { q1: '작년 답' }, isTest: true, testModeEnabled: false },
    ]);
    expect(await lookupPriorAnswers({ surveyId: SURVEY_ID, inviteToken: INVITE })).toBeNull();
  });

  it('테스트 모드가 켜져 있으면 테스트 대상자도 이월 응답을 받는다', async () => {
    selectChain.mockResolvedValue([
      { answers: { q1: '작년 답' }, isTest: true, testModeEnabled: true },
    ]);
    expect(await lookupPriorAnswers({ surveyId: SURVEY_ID, inviteToken: INVITE })).toEqual({
      q1: '작년 답',
    });
  });

  it('빈 묶음이거나 형태가 깨진 JSONB 는 null 로 수렴한다', async () => {
    selectChain.mockResolvedValue([{ answers: {}, isTest: false, testModeEnabled: false }]);
    expect(await lookupPriorAnswers({ surveyId: SURVEY_ID, inviteToken: INVITE })).toBeNull();

    selectChain.mockResolvedValue([
      { answers: '{"q1":"x"}', isTest: false, testModeEnabled: false },
    ]);
    expect(await lookupPriorAnswers({ surveyId: SURVEY_ID, inviteToken: INVITE })).toBeNull();
  });
});
