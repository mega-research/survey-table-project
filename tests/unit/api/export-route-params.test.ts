import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// export·split-preview 라우트가 includeNonRespondents 파라미터를 로더에 그대로 넘기는지,
// 그리고 .sav 경로는 그 파라미터를 읽지 않는지 본다. 로더 자체는 raw-export-rows.server.test 몫.

const {
  authState,
  surveyFindFirstMock,
  loadRawExportRowsMock,
  countRawExportPopulationMock,
  getContactColumnSchemeMock,
} = vi.hoisted(() => ({
  authState: { user: { id: 'admin' } as null | { id: string } },
  surveyFindFirstMock: vi.fn(),
  loadRawExportRowsMock: vi.fn(),
  countRawExportPopulationMock: vi.fn(),
  getContactColumnSchemeMock: vi.fn(),
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

// 컬럼 스킴 조회만 가짜로 — Raw Data 계열에서만 불려야 한다 (명단 열은 응답 내역 컬럼 설정 기준).
vi.mock('@/lib/operations/contacts.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/operations/contacts.server')>();
  return { ...actual, getContactColumnScheme: getContactColumnSchemeMock };
});

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
import { buildRawExportContext } from '@/lib/analytics/raw-export-rows.server';
import { normalizeContactColumnScheme } from '@/lib/operations/contacts';

const surveyId = 'survey-params';
const params = { params: Promise.resolve({ surveyId }) };

const ROSTER_SCHEME = normalizeContactColumnScheme({
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 0 },
    { key: '기수', label: '기수', source: 'attrs.기수', order: 1 },
    { key: '성명', label: '성명', source: 'pii.성명', order: 2, hidden: true, piiType: 'name' },
  ],
});

/** 로더에 넘어간 options (3번째 인자) */
function loaderOptions(): Record<string, unknown> {
  return loadRawExportRowsMock.mock.calls[0]![2] as Record<string, unknown>;
}

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
  getContactColumnSchemeMock.mockReset();
  getContactColumnSchemeMock.mockResolvedValue(ROSTER_SCHEME);
  vi.mocked(buildRawExportContext).mockClear();
  surveyFindFirstMock.mockReset();
  surveyFindFirstMock.mockResolvedValue(SURVEY_FIXTURE);
});

const SURVEY_FIXTURE = {
  id: surveyId,
  title: '파라미터 설문',
  requireInviteToken: false,
  profileColumns: null,
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
};

/** 응답 내역 컬럼 설정 — 기수·성명 표시, 2025_상태 숨김 */
const PROFILE_SCHEME = {
  version: 1,
  columns: [
    { key: 'sys.resid', label: 'UID', order: 0 },
    { key: 'sys.idx', label: '순번', order: 1 },
    { key: 'attrs.기수', label: '기수', order: 2 },
    { key: 'pii.성명', label: '성명', order: 3 },
    { key: 'sys.status', label: '상태', order: 4 },
  ],
};

const ATTRS_ONLY_PROFILE_SCHEME = {
  version: 1,
  columns: [
    { key: 'attrs.기수', label: '기수', order: 0 },
    { key: 'pii.성명', label: '성명', order: 1, hidden: true },
  ],
};

describe('GET /export — includeNonRespondents 파라미터', () => {
  it('raw 에 includeNonRespondents=1 이면 로더에 true 로 넘긴다', async () => {
    const res = await exportGet(exportRequest('type=raw&includeNonRespondents=1'), params);
    expect(res.status).toBe(200);
    expect(loadRawExportRowsMock).toHaveBeenCalledWith(surveyId, 'real', {
      includeNonRespondents: true,
      contactColumns: [],
    });
  });

  it('파라미터가 없으면 false 다', async () => {
    const res = await exportGet(exportRequest('type=raw'), params);
    expect(res.status).toBe(200);
    expect(loadRawExportRowsMock).toHaveBeenCalledWith(surveyId, 'real', {
      includeNonRespondents: false,
      contactColumns: [],
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
      contactColumns: [],
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

describe('GET /export — 조사 대상 명단 열 (응답 내역 컬럼 설정 기준, 토글 없음)', () => {
  it('raw 는 스코프 스킴을 1회 읽고 컬럼 설정에서 표시 중인 attrs·pii 열을 로더·컨텍스트에 넘기며 pii 가 있으면 no-store 다', async () => {
    surveyFindFirstMock.mockResolvedValue({ ...SURVEY_FIXTURE, profileColumns: PROFILE_SCHEME });
    const res = await exportGet(exportRequest('type=raw'), params);
    expect(res.status).toBe(200);
    expect(getContactColumnSchemeMock).toHaveBeenCalledTimes(1);
    expect(getContactColumnSchemeMock).toHaveBeenCalledWith(surveyId, 'real');

    const options = loaderOptions();
    expect(options['includeNonRespondents']).toBe(false);
    expect(options['contactColumns']).toEqual([
      { source: 'attrs.기수', label: '기수', kind: 'attrs', key: '기수' },
      { source: 'pii.성명', label: '성명', kind: 'pii', key: '성명' },
    ]);
    const ctxOptions = vi.mocked(buildRawExportContext).mock.calls[0]![3] as Record<string, unknown>;
    expect(ctxOptions['contactColumns']).toEqual(options['contactColumns']);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('pii 열이 컬럼 설정에서 숨김이면 attrs 열만 나가고 no-store 를 붙이지 않는다', async () => {
    surveyFindFirstMock.mockResolvedValue({
      ...SURVEY_FIXTURE,
      profileColumns: ATTRS_ONLY_PROFILE_SCHEME,
    });
    const res = await exportGet(exportRequest('type=raw'), params);
    expect(res.status).toBe(200);
    expect((loaderOptions()['contactColumns'] as unknown[]).length).toBe(1);
    expect(res.headers.get('Cache-Control')).toBeNull();
  });

  it('컬럼 설정이 없으면 명단 열 0개이고 헤더도 없다 — attrs·pii 는 기본 숨김', async () => {
    const res = await exportGet(exportRequest('type=raw'), params);
    expect(res.status).toBe(200);
    expect(loaderOptions()).toEqual({ includeNonRespondents: false, contactColumns: [] });
    expect(res.headers.get('Cache-Control')).toBeNull();
  });

  it('옛 includeContactColumns 파라미터는 아무 효과가 없다', async () => {
    const res = await exportGet(exportRequest('type=raw&includeContactColumns=1'), params);
    expect(res.status).toBe(200);
    expect(loaderOptions()['contactColumns']).toEqual([]);
  });

  it('raw-split 도 같은 열을 로더에 넘긴다 — 미응답 토글과 독립', async () => {
    surveyFindFirstMock.mockResolvedValue({ ...SURVEY_FIXTURE, profileColumns: PROFILE_SCHEME });
    const res = await exportGet(
      exportRequest('type=raw-split&basis=basis&includeNonRespondents=1'),
      params,
    );
    expect(res.status).toBe(200);
    expect(getContactColumnSchemeMock).toHaveBeenCalledTimes(1);
    const options = loaderOptions();
    expect(options['includeNonRespondents']).toBe(true);
    expect((options['contactColumns'] as unknown[]).length).toBe(2);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sav 는 스킴을 읽지 않는다', async () => {
    surveyFindFirstMock.mockResolvedValue({ ...SURVEY_FIXTURE, profileColumns: PROFILE_SCHEME });
    const res = await exportGet(exportRequest('type=sav'), params);
    expect(res.status).toBe(200);
    expect(getContactColumnSchemeMock).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBeNull();
  });

  it('컨택 스킴이 없으면(명단 미업로드) 표시 열이 있어도 0개로 정상 진행한다 — 400 이 아니다', async () => {
    getContactColumnSchemeMock.mockResolvedValue(null);
    surveyFindFirstMock.mockResolvedValue({ ...SURVEY_FIXTURE, profileColumns: PROFILE_SCHEME });
    const res = await exportGet(exportRequest('type=raw'), params);
    expect(res.status).toBe(200);
    expect(loaderOptions()['contactColumns']).toEqual([]);
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});
