/**
 * 짧은 초대 링크 라우트.
 *
 * 이 라우트는 procedure 를 지나지 않고 서버에서 조회를 마친다(0091b15d). 그래서
 * `withRateLimit` 이 세지 못하고, 실측으로 **`public-read` 버킷이 소진돼 잠긴 IP 가
 * 같은 순간 여기로는 60/60 그대로 들어왔다**(2026-08-25). 가드를 붙였고 이 파일이
 * 그 계약을 고정한다 — 특히 **가드가 조회보다 먼저** 돈다는 것.
 *
 * 가드 자체의 정책(fail-open·버킷 공유)은 rate-limit/rsc-guard.test.ts 소관이다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveInviteCodeMock, getSurveyForResponseMock, lookupContactAttrsMock, guardMock } =
  vi.hoisted(() => ({
    resolveInviteCodeMock: vi.fn(),
    getSurveyForResponseMock: vi.fn(),
    lookupContactAttrsMock: vi.fn(),
    guardMock: vi.fn(),
  }));

vi.mock('@/lib/rate-limit/rsc-guard', () => ({
  isRscRateLimited: (...a: unknown[]) => guardMock(...a),
}));
vi.mock('@/server/contacts/services/contact-invite.service', () => ({
  resolveInviteCode: (...a: unknown[]) => resolveInviteCodeMock(...a),
}));
vi.mock('@/server/survey-builder/services/survey-read.service', () => ({
  getSurveyForResponse: (...a: unknown[]) => getSurveyForResponseMock(...a),
}));
vi.mock('@/server/contacts/services/contact-attrs.service', () => ({
  lookupContactAttrs: (...a: unknown[]) => lookupContactAttrsMock(...a),
  // 팩토리는 호이스팅되므로 클래스도 여기서 만든다(상위 스코프 변수 참조 불가).
  InvalidTestLinkError: class InvalidTestLinkError extends Error {},
}));
function SurveyResponseFlowStub(): null {
  return null;
}
vi.mock('@/features/survey-response/survey-response-flow', () => ({
  SurveyResponseFlow: SurveyResponseFlowStub,
}));

import ShortInvitePage from '@/app/i/[code]/page';

const RESOLVED = {
  kind: 'valid' as const,
  surveyId: '00000000-0000-4000-8000-000000000901',
  accessIdentifier: 'my-slug',
  inviteToken: '11111111-2222-4333-8444-555555555555',
};

beforeEach(() => {
  vi.clearAllMocks();
  guardMock.mockResolvedValue(false);
  resolveInviteCodeMock.mockResolvedValue(RESOLVED);
  getSurveyForResponseMock.mockResolvedValue({ survey: { id: RESOLVED.surveyId } });
  lookupContactAttrsMock.mockResolvedValue(null);
});

describe('/i/[code] rate limit 가드', () => {
  it('한도 초과면 안내 화면을 돌려주고 어떤 조회도 하지 않는다', async () => {
    guardMock.mockResolvedValue(true);

    await ShortInvitePage({ params: Promise.resolve({ code: 'abc123' }) });

    // 조회 뒤에 막으면 DB 작업은 이미 나간 뒤라 가드의 목적이 사라진다.
    // 무효 코드도 여기서 잘려 열거 비용이 같은 한도 안에 들어온다.
    expect(resolveInviteCodeMock).not.toHaveBeenCalled();
    expect(getSurveyForResponseMock).not.toHaveBeenCalled();
    expect(lookupContactAttrsMock).not.toHaveBeenCalled();
  });

  it('RPC 경로와 같은 버킷을 쓴다', async () => {
    await ShortInvitePage({ params: Promise.resolve({ code: 'abc123' }) });

    // 버킷이 갈리면 "같은 일을 하는 두 문" 이 서로 다른 예산을 쓰게 된다.
    expect(guardMock).toHaveBeenCalledWith('public-read');
  });

  it('한도 안이면 종전대로 조회를 진행한다', async () => {
    await ShortInvitePage({ params: Promise.resolve({ code: 'abc123' }) });

    expect(resolveInviteCodeMock).toHaveBeenCalledWith('abc123');
    expect(getSurveyForResponseMock).toHaveBeenCalledTimes(1);
    expect(lookupContactAttrsMock).toHaveBeenCalledTimes(1);
  });

  it('무효 코드도 가드를 먼저 지난다', async () => {
    resolveInviteCodeMock.mockResolvedValue(null);

    await ShortInvitePage({ params: Promise.resolve({ code: 'nope' }) });

    expect(guardMock).toHaveBeenCalledTimes(1);
    expect(resolveInviteCodeMock).toHaveBeenCalledTimes(1);
  });
});
