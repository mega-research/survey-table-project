import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { NextRequest } from 'next/server';

const { authState } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string } },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: authState.user }, error: null })),
    },
  })),
}));

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

import { GET } from '@/app/api/surveys/[surveyId]/export/route';

describe('GET /api/surveys/[surveyId]/export requires authentication', () => {
  beforeEach(() => {
    authState.user = null;
  });

  afterEach(() => {
    delete process.env['ADMIN_USER_IDS'];
  });

  it('returns 403 for authenticated user not in ADMIN_USER_IDS allowlist', async () => {
    authState.user = { id: 'intruder-id' };
    process.env['ADMIN_USER_IDS'] = 'real-admin-id';

    const request = new NextRequest(
      'http://localhost/api/surveys/test-id/export?type=raw',
    );

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
