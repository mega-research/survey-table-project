import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractRawSql } from '../../../../../tests/integration/_helpers/result-code-mock';

const selectChain = vi.fn();
const executeMock = vi.fn();

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
    execute: (...args: unknown[]) => executeMock(...args),
  },
}));

import {
  loadChangeConfirmQuestionIds,
  lookupPriorAnswers,
} from './contact-prior-answers.service';

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

describe('lookupPriorAnswers PII 읽기 경계', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('암호문으로 적재된 이월 값을 평문으로 돌려준다', async () => {
    const { encryptAnswerValue } = await import('@/lib/crypto/response-pii');
    selectChain.mockResolvedValue([
      {
        answers: { q1: encryptAnswerValue('홍길동'), q2: '평문 그대로' },
        isTest: false,
        testModeEnabled: false,
      },
    ]);

    expect(await lookupPriorAnswers({ surveyId: SURVEY_ID, inviteToken: INVITE })).toEqual({
      q1: '홍길동',
      q2: '평문 그대로',
    });
  });
})

describe('loadChangeConfirmQuestionIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue([]);
  });

  it('비-UUID 설문 id 는 조회 없이 빈 집합', async () => {
    expect(await loadChangeConfirmQuestionIds('nope', { isTest: false })).toEqual(new Set());
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('이월 응답의 문항 키를 모은다', async () => {
    executeMock.mockResolvedValue([{ question_id: 'q1' }, { question_id: 'q2' }]);
    expect(await loadChangeConfirmQuestionIds(SURVEY_ID, { isTest: false })).toEqual(
      new Set(['q1', 'q2']),
    );
  });

  it('사이드카 키와 빈 값을 SQL 에서 걸러 유령 변수를 막는다', async () => {
    executeMock.mockResolvedValue([{ question_id: 'q1' }, { question_id: null }]);
    expect(await loadChangeConfirmQuestionIds(SURVEY_ID, { isTest: false })).toEqual(
      new Set(['q1']),
    );
    const sql = extractRawSql(executeMock.mock.calls[0]?.[0]);
    // 화면이 컨트롤을 띄우지 않는 값(빈 문자열·빈 배열·빈 객체·null)과 사이드카 키를
    // 질의 단계에서 제외해야 아무도 답할 수 없는 변수가 생기지 않는다.
    for (const fragment of ['left(', '__', 'jsonb_typeof', '\"\"', '[]', '{}']) {
      expect(sql).toContain(fragment);
    }
  });

  it('실/테스트 파티션을 조사 대상 기준으로 가른다', async () => {
    await loadChangeConfirmQuestionIds(SURVEY_ID, { isTest: true });
    expect(extractRawSql(executeMock.mock.calls[0]?.[0])).toContain('is_test');
  });

  it('이월 응답이 없으면 빈 집합 — 내보내기는 변동 확인 변수를 만들지 않는다', async () => {
    executeMock.mockResolvedValue([]);
    expect(await loadChangeConfirmQuestionIds(SURVEY_ID, { isTest: false })).toEqual(new Set());
  });
});
