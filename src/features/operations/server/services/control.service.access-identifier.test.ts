import { beforeEach, describe, expect, it, vi } from 'vitest';

const capturedSets: Array<Record<string, unknown>> = [];
let surveyRow: Record<string, unknown> | undefined;
let returningRows: Array<Record<string, unknown>> = [];
let countRows: Array<{ value: number }> = [{ value: 0 }];

vi.mock('@/db', () => ({
  db: {
    query: { surveys: { findFirst: vi.fn(async () => surveyRow) } },
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => countRows) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        capturedSets.push(payload);
        return { where: vi.fn(() => ({ returning: vi.fn(async () => returningRows) })) };
      }),
    })),
  },
}));

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'nano123456') }));

import { getControlState, setTestMode } from './control.service';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  capturedSets.length = 0;
  surveyRow = undefined;
  returningRows = [];
  countRows = [{ value: 0 }];
  vi.clearAllMocks();
});

describe('setTestMode 짧은 토큰 + accessIdentifier', () => {
  it('기존 토큰이 없으면 nanoid 로 짧은 토큰을 생성한다', async () => {
    surveyRow = { id: SURVEY_ID, slug: '게임-기초조사', privateToken: 'ptok', isPublic: true, testToken: null };
    returningRows = [{ testModeEnabled: true, testToken: 'nano123456' }];

    const res = await setTestMode({ surveyId: SURVEY_ID, enabled: true });

    expect(capturedSets[0]!['testToken']).toBe('nano123456');
    expect(res.testToken).toBe('nano123456');
    expect(res.accessIdentifier).toBe('게임-기초조사'); // 공개 → slug
  });

  it('기존 토큰이 있으면 재사용한다', async () => {
    surveyRow = { id: SURVEY_ID, slug: null, privateToken: 'ptok', isPublic: false, testToken: 'existing-tok' };
    returningRows = [{ testModeEnabled: true, testToken: 'existing-tok' }];

    const res = await setTestMode({ surveyId: SURVEY_ID, enabled: true });

    expect(capturedSets[0]!['testToken']).toBe('existing-tok');
    expect(res.accessIdentifier).toBe('ptok'); // 비공개 → privateToken
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
    countRows = [{ value: 0 }];

    const res = await getControlState(SURVEY_ID);

    expect(res.accessIdentifier).toBe('게임-기초조사');
    expect(res.testResponseCount).toBe(0);
    // privateToken/slug 원시값이 응답에 새지 않아야 한다(accessIdentifier 만 노출).
    expect('privateToken' in res).toBe(false);
    expect('slug' in res).toBe(false);
  });
});
