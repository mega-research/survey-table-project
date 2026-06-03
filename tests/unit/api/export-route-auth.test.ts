import { describe, expect, it, vi } from 'vitest';

import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
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

vi.mock('@/lib/excel-transformer', () => ({
  generateSummaryWorkbook: vi.fn(),
  generateVariableMapWorkbook: vi.fn(),
  generateRawDataWorkbook: vi.fn(),
}));

import { GET } from '@/app/api/surveys/[surveyId]/export/route';

describe('GET /api/surveys/[surveyId]/export requires authentication', () => {
  it('returns 401 without auth (summary type)', async () => {
    const request = new NextRequest(
      'http://localhost/api/surveys/test-id/export?type=summary',
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

  it('returns 401 without auth (map type)', async () => {
    const request = new NextRequest(
      'http://localhost/api/surveys/test-id/export?type=map',
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
});
