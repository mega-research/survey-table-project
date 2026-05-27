import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ========================
// 모듈 모킹
// ========================
//
// 진행 중(미완료) 응답만 존재하는 케이스.
// algorithm WHERE 에 isNotNull(completedAt) 이 포함되므로
// 미완료 row 는 DB 조회 결과에 포함되지 않는다 -> 통과.

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

describe('Track B: 미완료 응답만 존재 -> 통과', () => {
  it('진행 중(미완료) 응답만 존재 -> 통과 (algorithm WHERE 에서 completedAt NOT NULL 조건)', async () => {
    // isNotNull(completedAt) 조건으로 미완료 row 는 필터됨.
    // DB 가 undefined 반환 -> 차단되지 않음.
    mockFindFirst.mockResolvedValue(undefined);

    const r = await checkDuplicateOnEntry({
      surveyId: SURVEY_ID,
      clientSignals: BASE_SIGNALS,
    });

    expect(r).toEqual({ blocked: false });
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
  });
});
