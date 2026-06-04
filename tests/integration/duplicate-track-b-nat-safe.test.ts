import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ========================
// 모듈 모킹
// ========================
//
// Track B NAT 환경 시뮬레이션: 같은 fp+ip 이지만 다른 deviceId.
// algorithm 이 올바른 WHERE 를 빌드해도 DB 가 undefined 반환 -> 통과.

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
  findContactByInviteToken: vi.fn(async () => ({ kind: 'invalid' as const })),
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
  process.env['DUPLICATE_DETECTION_SALT'] = 'integration-test-salt';
});

beforeEach(() => {
  mockFindFirst.mockReset();
  mockHeaders.mockReset();
  mockHeaders.mockResolvedValue(
    new Headers({ 'x-forwarded-for': '10.0.0.1', 'user-agent': 'Chrome/120' }),
  );
});

describe('Track B: NAT 환경 시뮬레이션 -> 통과', () => {
  it('매칭 row 없음 (NAT 환경, 다른 deviceId) -> 통과', async () => {
    // algorithm 이 올바른 WHERE 를 빌드했지만 DB 에 매칭 행 없음
    mockFindFirst.mockResolvedValue(undefined);

    const r = await checkDuplicateOnEntry({
      surveyId: SURVEY_ID,
      clientSignals: { ...BASE_SIGNALS, deviceId: 'DIFFERENT-DEVICE' },
    });

    expect(r).toEqual({ blocked: false });
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
  });
});
