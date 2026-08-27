import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { NextRequest } from 'next/server';

const { authState } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string } },
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => {
    if (!authState.user) throw new Error('인증이 필요합니다.');
    return {
      id: authState.user.id,
      email: 'a@b.com',
      name: '테스트',
      status: 'active',
      isSuperadmin: false,
    };
  }),
}));

// 코어 capability 판정을 대체한다 — 어댑터(rest-survey-access)는 실물이 돌아
// 게스트 grant 분기·HTTP 매핑까지 관통 검증된다.
vi.mock('@/server/survey-access', () => {
  class SurveyAccessError extends Error {
    constructor(public readonly reason: 'not_found' | 'forbidden') {
      super(reason);
      this.name = 'SurveyAccessError';
    }
  }
  return { SurveyAccessError, assertSurveyCapability: vi.fn() };
});

vi.mock('@/db', () => ({
  db: {
    query: { surveys: { findFirst: vi.fn() }, surveyResponses: { findMany: vi.fn() } },
    select: vi.fn(),
  },
}));

vi.mock('@/db/schema', () => ({
  surveys: { id: 'surveys.id' },
  surveyResponses: { surveyId: 'survey_responses.survey_id', deletedAt: 'deleted_at', status: 'status' },
  contactTargets: { id: 'contact_targets.id', resid: 'resid', groupValue: 'group_value' },
}));

vi.mock('@/lib/analytics/raw-workbook', () => ({
  generateRawDataWorkbook: vi.fn(),
}));

vi.mock('@/lib/analytics/split-workbook', () => ({
  buildSplitWorkbook: vi.fn(),
}));

import { SurveyAccessError, assertSurveyCapability } from '@/server/survey-access';
import { GET } from '@/app/api/surveys/[surveyId]/export/route';
import { GET as GET_SPLIT_PREVIEW } from '@/app/api/surveys/[surveyId]/export/split-preview/route';

describe('GET /api/surveys/[surveyId]/export requires authentication', () => {
  beforeEach(() => {
    authState.user = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('게스트는 grant 밖 설문 export 가 403 이다 - oRPC scoped 와 같은 축', async () => {
    authState.user = { id: 'guest-1' };
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:other-survey');

    const request = new NextRequest(
      'http://localhost/api/surveys/test-id/export?type=raw',
    );

    const response = await GET(request, {
      params: Promise.resolve({ surveyId: 'test-id' }),
    });

    expect(response.status).toBe(403);
  });

  it('게스트는 grant 일치 설문 export 가 계속 열린다 - 차단은 티켓 21 몫 (회귀)', async () => {
    authState.user = { id: 'guest-1' };
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:test-id');

    const request = new NextRequest('http://localhost/api/surveys/test-id/export?type=raw');
    const response = await GET(request, {
      params: Promise.resolve({ surveyId: 'test-id' }),
    });

    // 관문을 지나 설문 조회(mock undefined)로 넘어갔다는 뜻의 404 - 관문 403/401 이 아니다.
    expect(response.status).toBe(404);
    expect(assertSurveyCapability).not.toHaveBeenCalled();
  });

  it('내부 계정이라도 타 팀 설문(export.download 불가)은 404 다 - 존재 은닉 (티켓 11)', async () => {
    authState.user = { id: 'admin-1' };
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new SurveyAccessError('not_found'));

    const request = new NextRequest('http://localhost/api/surveys/test-id/export?type=raw');
    const response = await GET(request, {
      params: Promise.resolve({ surveyId: 'test-id' }),
    });

    expect(response.status).toBe(404);
    expect(assertSurveyCapability).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1' }),
      'test-id',
      'export.download',
    );
  });

  it('split-preview 도 타 팀 설문이면 404 다 - 같은 관문을 지난다 (티켓 11)', async () => {
    authState.user = { id: 'admin-1' };
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new SurveyAccessError('not_found'));

    const request = new NextRequest('http://localhost/api/surveys/test-id/export/split-preview');
    const response = await GET_SPLIT_PREVIEW(request, {
      params: Promise.resolve({ surveyId: 'test-id' }),
    });

    expect(response.status).toBe(404);
  });

  it('보이는 설문의 export 권한만 없으면 403 이다', async () => {
    authState.user = { id: 'admin-1' };
    vi.mocked(assertSurveyCapability).mockRejectedValueOnce(new SurveyAccessError('forbidden'));

    const request = new NextRequest('http://localhost/api/surveys/test-id/export?type=sav');
    const response = await GET(request, {
      params: Promise.resolve({ surveyId: 'test-id' }),
    });

    expect(response.status).toBe(403);
  });

  it('returns 401 without auth (raw-split type)', async () => {
    const request = new NextRequest(
      'http://localhost/api/surveys/test-id/export?type=raw-split',
    );

    const response = await GET(request, {
      params: Promise.resolve({ surveyId: 'test-id' }),
    });

    expect(response.status).toBe(401);
  });

  it('returns 401 without auth (sav type)', async () => {
    const request = new NextRequest(
      'http://localhost/api/surveys/test-id/export?type=sav',
    );

    const response = await GET(request, {
      params: Promise.resolve({ surveyId: 'test-id' }),
    });

    expect(response.status).toBe(401);
  });

  it('returns 401 without auth (raw type)', async () => {
    const request = new NextRequest(
      'http://localhost/api/surveys/test-id/export?type=raw',
    );

    const response = await GET(request, {
      params: Promise.resolve({ surveyId: 'test-id' }),
    });

    expect(response.status).toBe(401);
  });

  it('returns 401 without auth (sps type)', async () => {
    const request = new NextRequest(
      'http://localhost/api/surveys/test-id/export?type=sps',
    );

    const response = await GET(request, {
      params: Promise.resolve({ surveyId: 'test-id' }),
    });

    expect(response.status).toBe(401);
  });
});
