import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSurveyOwnerEmail } from '@/server/read-models/survey-owner-email';

import { resolveSendReplyTo } from './reply-to';

vi.mock('@/server/read-models/survey-owner-email', () => ({
  getSurveyOwnerEmail: vi.fn(),
}));

const ownerEmail = vi.mocked(getSurveyOwnerEmail);

const BASE = {
  surveyId: 'sv-1',
  fromLocal: 'noreply',
  fromDomain: 'mail.example.com',
};

beforeEach(() => {
  ownerEmail.mockReset();
});

describe('resolveSendReplyTo', () => {
  it('스냅샷 회신 주소가 있으면 그대로 쓰고 소유자 조회를 하지 않는다', async () => {
    ownerEmail.mockResolvedValue('owner@example.com');

    await expect(resolveSendReplyTo({ ...BASE, replyTo: 'fixed@example.com' })).resolves.toBe(
      'fixed@example.com',
    );
    // 지연 평가 — 고정 회신 캠페인에 불필요한 DB 왕복과 장애 지점을 만들지 않는다.
    expect(ownerEmail).not.toHaveBeenCalled();
  });

  it('스냅샷이 비어 있으면 발송 시점 소유자 이메일로 해석한다', async () => {
    ownerEmail.mockResolvedValue('owner@example.com');

    await expect(resolveSendReplyTo({ ...BASE, replyTo: null })).resolves.toBe(
      'owner@example.com',
    );
    expect(ownerEmail).toHaveBeenCalledWith('sv-1');
  });

  it('소유자가 없으면 발신 주소로 폴백한다', async () => {
    ownerEmail.mockResolvedValue(null);

    await expect(resolveSendReplyTo({ ...BASE, replyTo: null })).resolves.toBe(
      'noreply@mail.example.com',
    );
  });

  it('발신 도메인이 없으면 폴백도 없다 — 호출부가 env 미설정으로 거부한다', async () => {
    ownerEmail.mockResolvedValue(null);

    await expect(
      resolveSendReplyTo({ ...BASE, replyTo: null, fromDomain: undefined }),
    ).resolves.toBeNull();
  });

  it('빈 문자열 스냅샷은 미설정과 같다 — 회신 주소로 쓰지 않는다', async () => {
    ownerEmail.mockResolvedValue('owner@example.com');

    await expect(resolveSendReplyTo({ ...BASE, replyTo: '  ' })).resolves.toBe(
      'owner@example.com',
    );
  });
});
