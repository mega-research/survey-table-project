import { describe, it, expect, vi, beforeEach } from 'vitest';

// ========================
// 모듈 모킹
// ========================
//
// checkDuplicateOnEntry -> checkTrackA -> findContactByInviteToken -> db / sql
// checkDuplicateOnEntry -> checkTrackB -> db.query.surveyResponses.findFirst
//
// Track A 경로는 inviteToken 이 있으면 headers() 를 호출하지 않으므로
// next/headers 모킹이 필요 없다.

type InviteTokenLookupResult =
  | { kind: 'valid'; contactTargetId: string; respondedAt: Date | null }
  | { kind: 'excluded' }
  | { kind: 'invalid' };

const h = vi.hoisted(() => {
  const findContactMock = vi.fn<
    (surveyId: string, inviteToken: string) => Promise<InviteTokenLookupResult>
  >();
  return { findContactMock };
});

vi.mock('@/actions/response-actions', () => ({
  findContactByInviteToken: h.findContactMock,
}));

// checkTrackB 가 호출하는 db.query.surveyResponses.findFirst mock
vi.mock('@/db', () => ({
  db: {
    query: {
      surveyResponses: {
        findFirst: vi.fn(async () => null),
      },
    },
  },
}));

// next/headers: Track A 경로는 headers() 를 호출하지 않지만
// 모듈 import 시 stub 이 있어야 resolve 오류 방지
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Map()),
}));

// signals.ts 가 import 하는 내부 모듈 stub
vi.mock('@/lib/duplicate-detection/signals', () => ({
  computeSignals: vi.fn(() => ({ ipHash: null, fpHash: null, deviceId: null })),
}));

import { checkDuplicateOnEntry } from '@/actions/duplicate-detection-actions';

const TEST_SURVEY_ID = 'aaaaaaaa-0001-0001-0001-000000000001';

const BASE_CLIENT_SIGNALS = {
  deviceId: 'd1',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

describe('Track A: invite_token 차단', () => {
  beforeEach(() => {
    h.findContactMock.mockReset();
  });

  it('이미 응답 완료된 토큰으로 진입 시 token_already_used', async () => {
    // 컨택이 존재하고 respondedAt 이 설정된 상태 (이미 응답 완료)
    h.findContactMock.mockResolvedValueOnce({
      kind: 'valid',
      contactTargetId: 'contact-id-001',
      respondedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const result = await checkDuplicateOnEntry({
      surveyId: TEST_SURVEY_ID,
      inviteToken: 'token-already-used-test',
      clientSignals: BASE_CLIENT_SIGNALS,
    });

    expect(result).toEqual({ blocked: true, reason: 'token_already_used' });
  });

  it('잘못된 토큰 -> invalid_token', async () => {
    // findContactByInviteToken 이 invalid 반환 (토큰 미존재)
    h.findContactMock.mockResolvedValueOnce({ kind: 'invalid' });

    const result = await checkDuplicateOnEntry({
      surveyId: TEST_SURVEY_ID,
      inviteToken: 'nonexistent-token-xyz',
      clientSignals: BASE_CLIENT_SIGNALS,
    });

    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.reason).toBe('invalid_token');
    }
  });

  it('미응답 유효 토큰은 통과 (blocked: false)', async () => {
    // 컨택 존재하지만 respondedAt 이 null (아직 응답 안 함)
    h.findContactMock.mockResolvedValueOnce({
      kind: 'valid',
      contactTargetId: 'contact-id-002',
      respondedAt: null,
    });

    const result = await checkDuplicateOnEntry({
      surveyId: TEST_SURVEY_ID,
      inviteToken: 'valid-unused-token',
      clientSignals: BASE_CLIENT_SIGNALS,
    });

    expect(result.blocked).toBe(false);
    if (!result.blocked) {
      expect(result.contactTargetId).toBe('contact-id-002');
    }
  });

  it('inviteToken 없을 때는 Track B 로 분기 (headers 경로)', async () => {
    // inviteToken 없으므로 checkTrackB 가 호출되고 findContactMock 은 호출 안 됨
    const result = await checkDuplicateOnEntry({
      surveyId: TEST_SURVEY_ID,
      inviteToken: undefined,
      clientSignals: BASE_CLIENT_SIGNALS,
    });

    // db.query.surveyResponses.findFirst 가 null 반환 -> 통과
    expect(result.blocked).toBe(false);
    expect(h.findContactMock).not.toHaveBeenCalled();
  });
});
