import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { NextRequest } from 'next/server';

const { authState } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string; userType?: 'internal' | 'guest' | 'fieldwork' } },
}));

// 실물 requireAuth 와 같은 정책을 흉내 낸다 — 세션 + active + **내부 계정**.
// 유형 검사를 빼면 게스트가 이 문을 지나는 세계를 테스트하게 되어, 실제로는 닫힌 문을
// 열린 것으로 검증한다.
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => {
    const user = authState.user;
    if (!user) throw new Error('인증이 필요합니다.');
    const userType = user.userType ?? 'internal';
    if (userType !== 'internal') throw new Error('인증이 필요합니다.');
    return {
      id: user.id,
      email: 'a@b.com',
      name: '테스트',
      status: 'active',
      isSuperadmin: false,
      userType,
    };
  }),
}));

// 코어 capability 판정을 대체한다 — 어댑터(rest-survey-access)는 실물이 돌아
// HTTP 매핑까지 관통 검증된다.
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

  // 티켓 11 은 게스트의 grant 설문 export 를 현행 유지로 남겼고(콘솔 다운로드 버튼이 살아
  // 있어서) 티켓 21 이 뒤집었다 — 스펙 §8 의 「게스트 export 항상 차단」. 이제 문은 두 겹이다:
  // requireAuth 의 유형 게이트에서 401, 설령 지나도 게스트 열에 export.download 가 없다.
  it.each(['guest', 'fieldwork'] as const)(
    '%s 계정은 어느 설문이든 export 가 401 이다 - 부여와 무관하다',
    async (userType) => {
      authState.user = { id: `${userType}-1`, userType };

      const request = new NextRequest('http://localhost/api/surveys/test-id/export?type=raw');
      const response = await GET(request, {
        params: Promise.resolve({ surveyId: 'test-id' }),
      });

      expect(response.status).toBe(401);
      expect(assertSurveyCapability).not.toHaveBeenCalled();
    },
  );

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
