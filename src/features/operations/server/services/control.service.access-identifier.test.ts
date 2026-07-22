import { nanoid } from 'nanoid';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';

import { getControlState, setTestMode } from './control.service';

const capturedSets: Array<Record<string, unknown>> = [];
let surveyRow: Record<string, unknown> | undefined;
let returningRows: Array<Record<string, unknown>> = [];
let testResponseCount = 0;
let testTargetCount = 0;
let firstTestInviteCode: string | null = null;

vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: { findFirst: vi.fn(async () => surveyRow) },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () =>
            surveyRow
              ? [
                  {
                    ...surveyRow,
                    testResponseCount,
                    testTargetCount,
                    firstTestInviteCode,
                  },
                ]
              : [],
          ),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        capturedSets.push(payload);
        if (surveyRow) Object.assign(surveyRow, payload);
        return { where: vi.fn(() => ({ returning: vi.fn(async () => returningRows) })) };
      }),
    })),
  },
}));

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'nano1234') }));

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  capturedSets.length = 0;
  surveyRow = undefined;
  returningRows = [];
  testResponseCount = 0;
  testTargetCount = 0;
  firstTestInviteCode = null;
  vi.clearAllMocks();
});

describe('setTestMode 짧은 토큰 + accessIdentifier', () => {
  it('기존 토큰이 없으면 nanoid 로 짧은 토큰을 생성한다', async () => {
    surveyRow = {
      id: SURVEY_ID,
      slug: '게임-기초조사',
      privateToken: 'ptok',
      isPublic: true,
      isPaused: false,
      pausedMessage: null,
      testModeEnabled: false,
      testToken: null,
    };
    returningRows = [{ testModeEnabled: true, testToken: 'nano1234' }];

    const res = await setTestMode({ surveyId: SURVEY_ID, enabled: true });

    expect(vi.mocked(nanoid)).toHaveBeenCalledWith(8); // 짧은 토큰은 8자
    expect(capturedSets[0]!['testToken']).toBe('nano1234');
    expect(res.testToken).toBe('nano1234');
    expect(res.accessIdentifier).toBe('게임-기초조사'); // 공개 → slug
    expect(res).toMatchObject({ testResponseCount: 0, testTargetCount: 0 });
  });

  it('기존 토큰이 있으면 재사용한다', async () => {
    surveyRow = {
      id: SURVEY_ID,
      slug: null,
      privateToken: 'ptok',
      isPublic: false,
      isPaused: false,
      pausedMessage: null,
      testModeEnabled: true,
      testToken: 'existing-tok',
    };
    returningRows = [{ testModeEnabled: true, testToken: 'existing-tok' }];

    const res = await setTestMode({ surveyId: SURVEY_ID, enabled: true });

    expect(vi.mocked(nanoid)).not.toHaveBeenCalled(); // 기존 토큰 재사용 시 신규 생성 없음
    expect(capturedSets[0]!['testToken']).toBe('existing-tok');
    expect(res.accessIdentifier).toBe('ptok'); // 비공개 → privateToken
  });

  it('OFF 입력은 DB를 수정하기 전에 거부한다', async () => {
    await expect(setTestMode({ surveyId: SURVEY_ID, enabled: false })).rejects.toThrow(
      '테스트 모드 OFF는 disableTestWorkspace를 사용해야 합니다.',
    );
    expect(capturedSets).toEqual([]);
  });
});

describe('getControlState accessIdentifier', () => {
  it('공개 설문은 slug 를 accessIdentifier 로 반환한다', async () => {
    surveyRow = {
      isPaused: false,
      pausedMessage: null,
      testModeEnabled: false,
      testToken: null,
      id: SURVEY_ID,
      slug: '게임-기초조사',
      privateToken: 'ptok',
      isPublic: true,
    };
    testResponseCount = 2;
    testTargetCount = 1;
    firstTestInviteCode = 'invite-first';

    const res = await getControlState(SURVEY_ID);

    expect(res.accessIdentifier).toBe('게임-기초조사');
    expect(res.testResponseCount).toBe(2);
    expect(res.testTargetCount).toBe(1);
    expect(res.firstTestInviteCode).toBe('invite-first');
    expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);
    // privateToken/slug 원시값이 응답에 새지 않아야 한다(accessIdentifier 만 노출).
    expect('privateToken' in res).toBe(false);
    expect('slug' in res).toBe(false);
  });
});
