import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// export·split-preview 라우트가 includeNonRespondents 파라미터를 로더에 그대로 넘기는지,
// 그리고 .sav 경로는 그 파라미터를 읽지 않는지 본다. 로더 자체는 raw-export-rows.server.test 몫.

const { authState, surveyFindFirstMock, loadRawExportRowsMock, countRawExportPopulationMock } =
  vi.hoisted(() => ({
    authState: { user: { id: 'admin' } as null | { id: string } },
    surveyFindFirstMock: vi.fn(),
    loadRawExportRowsMock: vi.fn(),
    countRawExportPopulationMock: vi.fn(),
  }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: authState.user }, error: null })),
    },
  })),
}));

vi.mock('@/lib/operations/data-scope.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/operations/data-scope.server')>();
  return { ...actual, loadOperationsDataScope: vi.fn(async () => 'real' as const) };
});

vi.mock('@/lib/operations/contact-stats.server', () => ({
  getSurveyContactStats: vi.fn(async () => ({ hasContacts: true, hasContactGroups: false })),
}));

vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: { findFirst: surveyFindFirstMock },
      surveyResponses: { findMany: vi.fn(async () => []) },
    },
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: () => Promise.resolve([{ total: 0 }]),
      };
      return chain;
    }),
  },
}));

vi.mock('@/lib/analytics/raw-export-rows.server', () => ({
  MAX_EXPORT_RESPONSES: 10000,
  loadRawExportRows: loadRawExportRowsMock,
  countRawExportPopulation: countRawExportPopulationMock,
  buildRawExportContext: vi.fn(async () => ({
    appUrl: '',
    stepLabels: new Map(),
    hasContacts: true,
    hasContactGroups: false,
    questionMeta: new Map(),
  })),
}));

vi.mock('@/lib/analytics/raw-workbook', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics/raw-workbook')>();
  return {
    ...actual,
    generateRawDataWorkbook: vi.fn(() => ({
      xlsx: { writeBuffer: vi.fn(async () => new ArrayBuffer(0)) },
    })),
  };
});

vi.mock('@/lib/analytics/split-workbook', () => ({
  buildSplitWorkbook: vi.fn(() => ({
    xlsx: { writeBuffer: vi.fn(async () => new ArrayBuffer(0)) },
  })),
}));

vi.mock('@/lib/spss/sav-builder', () => ({
  generateSavBuffer: vi.fn(async () => Buffer.alloc(0)),
}));

import { GET as exportGet } from '@/app/api/surveys/[surveyId]/export/route';
import { GET as splitPreviewGet } from '@/app/api/surveys/[surveyId]/export/split-preview/route';

const surveyId = 'survey-params';
const params = { params: Promise.resolve({ surveyId }) };

function exportRequest(query: string) {
  return new NextRequest(`http://localhost/api/surveys/${surveyId}/export?${query}`);
}

function previewRequest(query: string) {
  return new NextRequest(
    `http://localhost/api/surveys/${surveyId}/export/split-preview${query ? `?${query}` : ''}`,
  );
}

beforeEach(() => {
  delete process.env['ADMIN_USER_IDS'];
  authState.user = { id: 'admin' };
  loadRawExportRowsMock.mockReset();
  loadRawExportRowsMock.mockResolvedValue({
    kind: 'ok',
    rows: [],
    responseCount: 0,
    nonRespondentCount: 0,
  });
  countRawExportPopulationMock.mockReset();
  countRawExportPopulationMock.mockResolvedValue({ responseCount: 3, nonRespondentCount: 2 });
  surveyFindFirstMock.mockReset();
  surveyFindFirstMock.mockResolvedValue({
    id: surveyId,
    title: '파라미터 설문',
    requireInviteToken: false,
    questions: [
      {
        id: 'basis',
        surveyId,
        type: 'radio',
        title: '분류',
        required: false,
        order: 0,
        options: [{ id: 'option-1', value: 'option-1', label: '옵션 1' }],
      },
    ],
  });
});

describe('GET /export — includeNonRespondents 파라미터', () => {
  it('raw 에 includeNonRespondents=1 이면 로더에 true 로 넘긴다', async () => {
    const res = await exportGet(exportRequest('type=raw&includeNonRespondents=1'), params);
    expect(res.status).toBe(200);
    expect(loadRawExportRowsMock).toHaveBeenCalledWith(surveyId, 'real', {
      includeNonRespondents: true,
    });
  });

  it('파라미터가 없으면 false 다', async () => {
    const res = await exportGet(exportRequest('type=raw'), params);
    expect(res.status).toBe(200);
    expect(loadRawExportRowsMock).toHaveBeenCalledWith(surveyId, 'real', {
      includeNonRespondents: false,
    });
  });

  it('raw-split 도 같은 파라미터를 로더에 넘긴다', async () => {
    const res = await exportGet(
      exportRequest('type=raw-split&basis=basis&includeNonRespondents=1'),
      params,
    );
    expect(res.status).toBe(200);
    expect(loadRawExportRowsMock).toHaveBeenCalledWith(surveyId, 'real', {
      includeNonRespondents: true,
    });
  });

  it('sav 는 파라미터를 무시하고 로더를 부르지 않는다', async () => {
    const res = await exportGet(exportRequest('type=sav&includeNonRespondents=1'), params);
    expect(res.status).toBe(200);
    expect(loadRawExportRowsMock).not.toHaveBeenCalled();
  });

  it('로더가 too_many 를 주면 413 이고 켜짐 메시지에 두 수치가 들어간다', async () => {
    loadRawExportRowsMock.mockResolvedValue({
      kind: 'too_many',
      responseCount: 9999,
      nonRespondentCount: 5,
    });
    const res = await exportGet(exportRequest('type=raw&includeNonRespondents=1'), params);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain(`응답 ${(9999).toLocaleString()}건`);
    expect(body.error).toContain('미응답 조사 대상 5명');
  });

  it('꺼진 경로의 too_many 메시지는 기존 문구 그대로다', async () => {
    loadRawExportRowsMock.mockResolvedValue({
      kind: 'too_many',
      responseCount: 10001,
      nonRespondentCount: 0,
    });
    const res = await exportGet(exportRequest('type=raw'), params);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      `응답이 ${(10000).toLocaleString()}건을 초과하여 내보내기할 수 없습니다.`,
    );
  });
});

describe('GET /export/split-preview — includeNonRespondents 파라미터', () => {
  it('basis + includeNonRespondents=1 이면 totalRows·nonRespondentRows 를 싣는다', async () => {
    const res = await splitPreviewGet(previewRequest('basis=basis&includeNonRespondents=1'), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['plan']).toBeDefined();
    expect(body['totalRows']).toBe(5);
    expect(body['nonRespondentRows']).toBe(2);
    expect(countRawExportPopulationMock).toHaveBeenCalledWith(surveyId, 'real', {
      includeNonRespondents: true,
    });
  });

  it('파라미터가 없으면 두 키가 없고 모수 count 를 부르지 않는다', async () => {
    const res = await splitPreviewGet(previewRequest('basis=basis'), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['plan']).toBeDefined();
    expect('totalRows' in body).toBe(false);
    expect('nonRespondentRows' in body).toBe(false);
    expect(countRawExportPopulationMock).not.toHaveBeenCalled();
  });

  it('basis 없는 요약에 hasContacts 가 있다', async () => {
    const res = await splitPreviewGet(previewRequest(''), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['hasContacts']).toBe(true);
    expect(body['totalVars']).toBeTypeOf('number');
  });
});
