import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.query.surveyResponses.findFirst 와 findContactByInviteToken 을 mock
const { mockFindFirst, mockFindContact } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFindContact: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: { query: { surveyResponses: { findFirst: mockFindFirst } } },
}));

vi.mock('@/actions/response-actions', () => ({
  findContactByInviteToken: mockFindContact,
}));

describe('checkTrackA (invite_token)', () => {
  beforeEach(() => {
    mockFindContact.mockReset();
  });

  it('토큰 없음 → invalid_token', async () => {
    mockFindContact.mockResolvedValue({ kind: 'invalid' });
    const { checkTrackA } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackA('survey-1', 'bad-token');
    expect(r).toEqual({ blocked: true, reason: 'invalid_token' });
  });

  it('토큰 + respondedAt 있음 → token_already_used', async () => {
    mockFindContact.mockResolvedValue({
      kind: 'valid',
      contactTargetId: 'c1',
      respondedAt: new Date(),
    });
    const { checkTrackA } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackA('survey-1', 'used-token');
    expect(r).toEqual({ blocked: true, reason: 'token_already_used' });
  });

  it('토큰 미사용 → 통과 + contactTargetId', async () => {
    mockFindContact.mockResolvedValue({
      kind: 'valid',
      contactTargetId: 'c1',
      respondedAt: null,
    });
    const { checkTrackA } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackA('survey-1', 'fresh-token');
    expect(r).toEqual({ blocked: false, contactTargetId: 'c1' });
  });

  it('excluded 부정 결과코드 OR unsubscribed → excluded_from_population', async () => {
    mockFindContact.mockResolvedValue({ kind: 'excluded' });
    const { checkTrackA } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackA('survey-1', 'excluded-token');
    expect(r).toEqual({ blocked: true, reason: 'excluded_from_population' });
  });
});

describe('checkTrackB (신호 기반)', () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
  });

  it('매칭 row 없음 → 통과', async () => {
    mockFindFirst.mockResolvedValue(undefined);
    const { checkTrackB } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackB({
      surveyId: 's1',
      signals: { ipHash: 'iH', fpHash: 'fH', deviceId: 'dev1' },
    });
    expect(r).toEqual({ blocked: false });
  });

  it('매칭 row 있음 → device_already_responded', async () => {
    mockFindFirst.mockResolvedValue({ id: 'existing' });
    const { checkTrackB } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackB({
      surveyId: 's1',
      signals: { ipHash: 'iH', fpHash: 'fH', deviceId: 'dev1' },
    });
    expect(r).toEqual({ blocked: true, reason: 'device_already_responded' });
  });

  it('모든 신호 null → 통과 (검사할 신호 없음)', async () => {
    mockFindFirst.mockResolvedValue(undefined);
    const { checkTrackB } = await import('@/lib/duplicate-detection/check');
    const r = await checkTrackB({
      surveyId: 's1',
      signals: { ipHash: null, fpHash: null, deviceId: null },
    });
    expect(r).toEqual({ blocked: false });
  });
});
