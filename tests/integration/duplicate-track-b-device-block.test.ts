import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ========================
// 모듈 모킹
// ========================
//
// Track B 경로: inviteToken 없이 checkDuplicateOnEntry 호출
// checkDuplicateOnEntry -> headers() -> computeSignals -> checkTrackB -> db.query.findFirst
//
// DB 조회 결과(findFirst)를 시나리오별로 제어하여 blocked/passed 를 검증.
// WHERE 절 SQL 정확성은 Task 7 단위 테스트에서 커버.

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

// Track A 경로 내부에서 사용하는 response-actions 를 stub — Track B 에서는 호출되지 않지만
// check.ts 가 import 하므로 resolve 오류 방지를 위해 모킹.
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

describe('Track B: deviceId 일치 완료 응답 존재 -> 차단', () => {
  it('같은 deviceId 완료 응답 있음 -> device_already_responded', async () => {
    // DB 에서 매칭 row 반환 (algorithm 이 올바른 WHERE 로 조회했다고 가정)
    mockFindFirst.mockResolvedValue({ id: 'existing-response' });

    const r = await checkDuplicateOnEntry({
      surveyId: SURVEY_ID,
      clientSignals: BASE_SIGNALS,
    });

    expect(r).toEqual({ blocked: true, reason: 'device_already_responded' });
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
  });
});
