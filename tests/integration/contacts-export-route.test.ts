import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
// 통 mock 은 import 체인 확장에 깨지므로 원본 spread 위에 필요한 것만 덮는다.
vi.mock('@/lib/auth/guest-grants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/guest-grants')>()),
  canAccessSurvey: vi.fn(),
}));
vi.mock('@/server/data-scope', () => ({
  loadOperationsDataScope: vi.fn(),
}));
vi.mock('@/server/read-models/contacts', () => ({
  getContactColumnScheme: vi.fn(),
  listContactsForExport: vi.fn(),
  MAX_CONTACT_EXPORT_ROWS: 50000,
}));
vi.mock('@/server/operations/services/contacts-export', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/server/operations/services/contacts-export')>();
  return { ...actual, decryptPiiForExport: vi.fn(async () => new Map()) };
});

import { requireAuth } from '@/lib/auth';
import { canAccessSurvey } from '@/lib/auth/guest-grants';
import { loadOperationsDataScope } from '@/server/data-scope';
import {
  getContactColumnScheme,
  listContactsForExport,
} from '@/server/read-models/contacts';
import { GET } from '@/app/api/surveys/[surveyId]/contacts/export/route';
import { normalizeContactColumnScheme } from '@/lib/operations/contacts-format';

const SCHEME = normalizeContactColumnScheme({
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '번호', source: 'system.resid' as const, order: 0 },
    { key: '회사명', label: '회사명', source: 'attrs.회사명' as const, order: 1 },
  ],
})!;

function makeRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/surveys/s1/contacts/export${query}`);
}

const params = { params: Promise.resolve({ surveyId: 's1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ id: 'u1' } as never);
  vi.mocked(canAccessSurvey).mockReturnValue(true);
  vi.mocked(loadOperationsDataScope).mockResolvedValue('real');
  vi.mocked(getContactColumnScheme).mockResolvedValue(SCHEME);
  vi.mocked(listContactsForExport).mockResolvedValue([
    {
      id: 't1',
      resid: 1,
      attrs: { 회사명: '메가리서치' },
      inviteCode: 'abc',
      latestResultCode: null,
      latestAttemptNo: null,
      progressPct: null,
      responseStatus: null,
      latestMailStatus: null,
    },
  ]);
});

describe('GET /api/surveys/[surveyId]/contacts/export', () => {
  it('비인증이면 401', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('인증이 필요합니다.'));
    const res = await GET(makeRequest('?cols=system.resid'), params);
    expect(res.status).toBe(401);
  });

  it('접근 권한 없으면 403', async () => {
    vi.mocked(canAccessSurvey).mockReturnValue(false);
    const res = await GET(makeRequest('?cols=system.resid'), params);
    expect(res.status).toBe(403);
  });

  it('유효 컬럼 0개면 400', async () => {
    const res = await GET(makeRequest('?cols=attrs.없는키'), params);
    expect(res.status).toBe(400);
  });

  it('스킴 없으면 400', async () => {
    vi.mocked(getContactColumnScheme).mockResolvedValue(null);
    const res = await GET(makeRequest('?cols=system.resid'), params);
    expect(res.status).toBe(400);
  });

  it('상한 초과면 400', async () => {
    vi.mocked(listContactsForExport).mockResolvedValue(
      Array.from({ length: 50001 }, (_, i) => ({
        id: `t${i}`,
        resid: i,
        attrs: {},
        inviteCode: 'c',
        latestResultCode: null,
        latestAttemptNo: null,
        progressPct: null,
        responseStatus: null,
        latestMailStatus: null,
      })),
    );
    const res = await GET(makeRequest('?cols=system.resid'), params);
    expect(res.status).toBe(400);
  });

  it('정상이면 xlsx MIME 과 filename 헤더로 응답', async () => {
    const res = await GET(
      makeRequest(`?cols=system.resid&cols=${encodeURIComponent('attrs.회사명')}`),
      params,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers.get('Content-Disposition')).toContain('.xlsx');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
  });

  it('설문이 없으면 404', async () => {
    vi.mocked(loadOperationsDataScope).mockRejectedValue(
      new Error('설문을 찾을 수 없습니다.'),
    );
    const res = await GET(makeRequest('?cols=system.resid'), params);
    expect(res.status).toBe(404);
  });
});
