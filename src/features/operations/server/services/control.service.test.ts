import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setPaused } from './control.service';

// db.update().set().where().returning() 체인의 set 페이로드와 where 조건을 캡처하도록 stub.
const capturedSets: Array<Record<string, unknown>> = [];
let returningRows: Array<Record<string, unknown>> = [];

vi.mock('@/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        capturedSets.push(payload);
        return {
          where: vi.fn((cond: unknown) => {
            void cond;
            return { returning: vi.fn(async () => returningRows) };
          }),
        };
      }),
    })),
  },
}));

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  capturedSets.length = 0;
  returningRows = [];
  vi.clearAllMocks();
});

describe('setPaused pausedMessage 3분기', () => {
  it('문자열 전달 시 pausedMessage 를 갱신한다', async () => {
    returningRows = [{ isPaused: true, pausedMessage: '점검 중' }];

    const res = await setPaused({
      surveyId: SURVEY_ID,
      isPaused: true,
      pausedMessage: '점검 중',
    });

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]!).toMatchObject({ isPaused: true, pausedMessage: '점검 중' });
    expect(res).toEqual({ isPaused: true, pausedMessage: '점검 중' });
  });

  it('미전달(undefined) 시 set 페이로드에 pausedMessage 키 자체가 없어 기존 문구를 보존한다', async () => {
    returningRows = [{ isPaused: false, pausedMessage: '이전 문구' }];

    const res = await setPaused({ surveyId: SURVEY_ID, isPaused: false });

    expect(capturedSets).toHaveLength(1);
    expect(capturedSets[0]!).toMatchObject({ isPaused: false });
    // 키 부재 검증 — toMatchObject 는 부재를 판별하지 못하므로 in 연산자로 직접 확인.
    expect('pausedMessage' in capturedSets[0]!).toBe(false);
    expect(res).toEqual({ isPaused: false, pausedMessage: '이전 문구' });
  });

  it('null 전달 시 pausedMessage 를 null 로 갱신한다', async () => {
    returningRows = [{ isPaused: true, pausedMessage: null }];

    const res = await setPaused({ surveyId: SURVEY_ID, isPaused: true, pausedMessage: null });

    expect(capturedSets).toHaveLength(1);
    expect('pausedMessage' in capturedSets[0]!).toBe(true);
    expect(capturedSets[0]!['pausedMessage']).toBeNull();
    expect(res).toEqual({ isPaused: true, pausedMessage: null });
  });
});
