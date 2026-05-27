import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ========================
// 모듈 모킹
// ========================
//
// 시크릿 모드: deviceId 가 null (localStorage 차단).
// fp+ip 매칭 row 가 DB 에 존재 -> 차단.

const { mockFindFirst, mockHeaders } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockHeaders: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: { query: { surveyResponses: { findFirst: mockFindFirst } } },
}));

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}));

vi.mock('@/actions/response-actions', () => ({
  findContactByInviteToken: vi.fn(async () => null),
}));

import { checkDuplicateOnEntry } from '@/actions/duplicate-detection-actions';

const SURVEY_ID = 'aaaaaaaa-0002-0002-0002-000000000002';

const BASE_SIGNALS = {
  deviceId: 'device-uuid-A',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

beforeAll(() => {
  process.env.DUPLICATE_DETECTION_SALT = 'integration-test-salt';
});

beforeEach(() => {
  mockFindFirst.mockReset();
  mockHeaders.mockReset();
  mockHeaders.mockResolvedValue(
    new Headers({ 'x-forwarded-for': '10.0.0.1', 'user-agent': 'Chrome/120' }),
  );
});

describe('Track B: 시크릿 모드 (deviceId=null) -> 차단', () => {
  it('시크릿 모드 deviceId=null, fp+ip 매칭 row 존재 -> device_already_responded', async () => {
    // deviceId=null 이면 cond1 은 sql`false`, cond2 의 deviceConstraint 는 sql`true`
    // -> fp+ip 일치만으로 차단 가능. DB 가 매칭 row 반환.
    mockFindFirst.mockResolvedValue({ id: 'matched-secret' });

    const r = await checkDuplicateOnEntry({
      surveyId: SURVEY_ID,
      clientSignals: { ...BASE_SIGNALS, deviceId: null },
    });

    expect(r).toEqual({ blocked: true, reason: 'device_already_responded' });
    expect(mockFindFirst).toHaveBeenCalled();
  });
});
