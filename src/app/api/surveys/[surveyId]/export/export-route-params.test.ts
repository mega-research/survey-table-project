import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// export·split-preview 라우트가 includeNonRespondents 파라미터를 로더에 그대로 넘기는지,
// 그리고 .sav 경로는 그 파라미터를 읽지 않는지 본다. 로더 자체는 raw-export-load.test.ts 몫.

const {
  authState,
  surveyFindFirstMock,
  loadRawExportRowsMock,
  countRawExportPopulationMock,
  getContactColumnSchemeMock,
  loadFieldCompletedCodesMock,
} = vi.hoisted(() => ({
  authState: { user: { id: 'admin' } as null | { id: string } },
  surveyFindFirstMock: vi.fn(),
  loadRawExportRowsMock: vi.fn(),
  countRawExportPopulationMock: vi.fn(),
  getContactColumnSchemeMock: vi.fn(),
  // 기본은 실사완료 코드 없음 — 옵션 모양이 도입 전과 같다. 실사완료 케이스만 값을 준다.
  loadFieldCompletedCodesMock: vi.fn(async (): Promise<string[]> => []),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: authState.user }, error: null })),
    },
  })),
}));

vi.mock('@/server/data-scope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/data-scope')>();
  return { ...actual, loadOperationsDataScope: vi.fn(async () => 'real' as const) };
});

vi.mock('@/server/operations/services/contact-stats', () => ({
  getSurveyContactStats: vi.fn(async () => ({ hasContacts: true })),
}));

// 컬럼 스킴 조회만 가짜로 — Raw Data 계열에서만 불려야 한다 (명단 열은 응답 내역 컬럼 설정 기준).
vi.mock('@/server/read-models/contacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/read-models/contacts')>();
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

vi.mock('./raw-export-load', () => ({
  MAX_EXPORT_RESPONSES: 10000,
  loadRawExportRows: loadRawExportRowsMock,
  countRawExportPopulation: countRawExportPopulationMock,
  rawResponseWhere: vi.fn(() => undefined),
  // .sps 경로는 이 스위트가 보지 않지만, 모듈에 있는 export 를 빠뜨리면 그 경로를
  // 건드리는 순간 "mock 에 없는 export" 로 엉뚱하게 깨진다.
  loadUsedRepeatCounts: vi.fn(async () => new Map<string, number>()),
  loadUnusedColumnIds: vi.fn(async () => new Map<string, Set<string>>()),
  loadLanguageSetLocales: vi.fn(async () => new Map()),
  loadFieldCompletedCodes: loadFieldCompletedCodesMock,
  buildRawExportContext: vi.fn(async () => ({
    appUrl: '',
    stepLabels: new Map(),
    hasContacts: true,
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
import { buildRawExportContext } from './raw-export-load';
import { normalizeContactColumnScheme } from '@/lib/operations/contacts-format';
import { generateRawDataWorkbook } from '@/lib/analytics/raw-workbook';
import { generateSavBuffer } from '@/lib/spss/sav-builder';

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
      includePriorAnswers: false,
      contactColumns: [],
      questions: expect.any(Array),
    });
  });

  it('raw 에 includePriorAnswers=1 이면 로더에 true 로 넘긴다', async () => {
    const res = await exportGet(exportRequest('type=raw&includePriorAnswers=1'), params);
    expect(res.status).toBe(200);
    expect(loadRawExportRowsMock).toHaveBeenCalledWith(surveyId, 'real', {
      includeNonRespondents: false,
      includePriorAnswers: true,
      contactColumns: [],
      questions: expect.any(Array),
    });
  });

  it('파라미터가 없으면 false 다', async () => {
    const res = await exportGet(exportRequest('type=raw'), params);
    expect(res.status).toBe(200);
    expect(loadRawExportRowsMock).toHaveBeenCalledWith(surveyId, 'real', {
      includeNonRespondents: false,
      includePriorAnswers: false,
      contactColumns: [],
      questions: expect.any(Array),
    });
  });

  it('미응답자 포함이 꺼져 있으면 실사완료 코드를 읽어 로더에 넘긴다 — 켜면 읽지 않는다', async () => {
    loadFieldCompletedCodesMock.mockResolvedValueOnce(['1.조사완료']);
    const off = await exportGet(exportRequest('type=raw'), params);
    expect(off.status).toBe(200);
    expect(loadFieldCompletedCodesMock).toHaveBeenCalledWith(surveyId);
    expect(loadRawExportRowsMock).toHaveBeenLastCalledWith(
      surveyId,
      'real',
      expect.objectContaining({ includeNonRespondents: false, fieldCompletedCodes: ['1.조사완료'] }),
    );

    loadFieldCompletedCodesMock.mockClear();
    const on = await exportGet(exportRequest('type=raw&includeNonRespondents=1'), params);
    expect(on.status).toBe(200);
    expect(loadFieldCompletedCodesMock).not.toHaveBeenCalled();
    expect(loadRawExportRowsMock.mock.lastCall?.[2]).not.toHaveProperty('fieldCompletedCodes');
  });

  it('raw-split 도 같은 파라미터를 로더에 넘긴다', async () => {
    const res = await exportGet(
      exportRequest('type=raw-split&basis=basis&includeNonRespondents=1'),
      params,
    );
    expect(res.status).toBe(200);
    expect(loadRawExportRowsMock).toHaveBeenCalledWith(surveyId, 'real', {
      includeNonRespondents: true,
      includePriorAnswers: false,
      contactColumns: [],
      questions: expect.any(Array),
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
    expect(loaderOptions()).toEqual({
      includeNonRespondents: false,
      includePriorAnswers: false,
      contactColumns: [],
      questions: expect.any(Array),
    });
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

/**
 * 게스트의 내려받기 (2026-11-16) — 내보내기를 허용한 grant 만 받고, 받는 파일은 개인정보로 표시된 값이
 * 가려진다. 버튼은 화면에서 숨기지만 이 주소는 직접 부를 수 있어 여기서 막는다.
 */
describe('GET /export — 게스트의 내려받기', () => {
  // guest9 — guest-grants.ts 의 VIEW_ONLY_GUEST_GRANTS 에서 allowExport 를 켠 실제 쌍.
  const GUEST9 = 'c79af8a1-186a-4157-be4c-2bebfbde4a8d';
  const AI_2026_PUBLIC = '253534a5-913a-4891-a019-f9643ccea0a7';
  // dairy@ — 보기 전용이지만 allowExport 가 꺼져 있다.
  const DAIRY = '75060289-51b4-44e7-8fd1-dabf73a0bfaf';
  const DAIRY_2026 = '24b15972-36fe-400a-adfe-7d4c80438204';

  const paramsOf = (id: string) => ({ params: Promise.resolve({ surveyId: id }) });
  const requestOf = (id: string, query: string) =>
    new NextRequest(`http://localhost/api/surveys/${id}/export?${query}`);
  const previewOf = (id: string) =>
    new NextRequest(`http://localhost/api/surveys/${id}/export/split-preview`);

  const PII_SURVEY = {
    ...SURVEY_FIXTURE,
    id: AI_2026_PUBLIC,
    profileColumns: PROFILE_SCHEME,
    questions: [
      {
        id: 'q-info',
        surveyId: AI_2026_PUBLIC,
        type: 'table',
        title: '기업 소개',
        required: true,
        order: 0,
        tableColumns: [{ id: 'col-1', label: '값' }],
        tableRowsData: [
          {
            id: 'r1',
            label: '응답자',
            cells: [
              { id: 'c-dept', type: 'input', content: '' },
              { id: 'c-name', type: 'input', content: '', piiEncrypted: true },
              { id: 'c-tel', type: 'input', content: '', inputType: 'phone', piiEncrypted: true },
              { id: 'c-mail', type: 'input', content: '', inputType: 'email', piiEncrypted: true },
            ],
          },
        ],
      },
    ],
  };
  const ROW = {
    id: 'resp-1',
    questionResponses: {
      'q-info': {
        'c-dept': '연구소/책임',
        'c-name': '홍길동',
        'c-tel': '02-345-6789',
        'c-mail': 'asdf@naver.com',
      },
    },
    contactValues: { 'attrs.기수': '3기', 'pii.성명': '김영희' },
    entryParams: { euid: 'panel-77' },
  };

  beforeEach(() => {
    process.env['ADMIN_USER_IDS'] = 'admin';
    process.env['GUEST_SURVEY_GRANTS'] =
      `${GUEST9}:${AI_2026_PUBLIC},${DAIRY}:${DAIRY_2026},field-1:${AI_2026_PUBLIC}`;
    surveyFindFirstMock.mockResolvedValue(PII_SURVEY);
    loadRawExportRowsMock.mockResolvedValue({
      kind: 'ok',
      rows: [ROW],
      responseCount: 1,
      nonRespondentCount: 0,
    });
    vi.mocked(generateRawDataWorkbook).mockClear();
    vi.mocked(generateSavBuffer).mockClear();
  });
  afterEach(() => {
    delete process.env['ADMIN_USER_IDS'];
    delete process.env['GUEST_SURVEY_GRANTS'];
  });

  const workbookRows = () =>
    vi.mocked(generateRawDataWorkbook).mock.calls[0]![1] as unknown as (typeof ROW)[];

  it('내보내기를 허용하지 않은 게스트는 주소를 직접 불러도 받지 못한다 — 보기 전용이든 일반 게스트든', async () => {
    for (const [userId, id] of [
      [DAIRY, DAIRY_2026],
      ['field-1', AI_2026_PUBLIC],
    ] as const) {
      authState.user = { id: userId };
      for (const type of ['raw', 'raw-split', 'sav', 'sps']) {
        const res = await exportGet(requestOf(id, `type=${type}&basis=q-info`), paramsOf(id));
        expect(res.status, `${userId} ${type}`).toBe(403);
      }
      const preview = await splitPreviewGet(previewOf(id), paramsOf(id));
      expect(preview.status, `${userId} split-preview`).toBe(403);
    }
    expect(loadRawExportRowsMock).not.toHaveBeenCalled();
    expect(generateSavBuffer).not.toHaveBeenCalled();
  });

  it('허용한 게스트의 Raw 파일은 개인정보로 표시된 칸과 명단 개인정보 열만 가려서 나간다', async () => {
    authState.user = { id: GUEST9 };
    const res = await exportGet(requestOf(AI_2026_PUBLIC, 'type=raw'), paramsOf(AI_2026_PUBLIC));
    expect(res.status).toBe(200);

    // 답은 로더가 가린다 — 라우트는 가리는 함수를 넘긴다(저장된 모양까지 본다).
    const maskAnswers = loaderOptions()['maskAnswers'] as (
      plain: Record<string, unknown>,
      stored: Record<string, unknown> | null,
    ) => Record<string, unknown>;
    expect(maskAnswers(ROW.questionResponses, null)['q-info']).toEqual({
      'c-dept': '연구소/책임',
      'c-name': '홍길*',
      'c-tel': '02-345...',
      'c-mail': 'asd...@nav...',
    });
    // 지금은 표시가 꺼진 칸이라도 암호문으로 저장돼 있었으면 가린다
    expect(
      maskAnswers(ROW.questionResponses, { 'q-info': { 'c-dept': 'v1:aaaa' } })['q-info'],
    ).toMatchObject({ 'c-dept': '연구소/책*' });

    const [row] = workbookRows();
    // 명단 — 일반 열은 그대로, 개인정보 열(성명)은 마지막 글자만
    expect(row!.contactValues).toEqual({ 'attrs.기수': '3기', 'pii.성명': '김영*' });
    // 패널 회원 ID 는 그대로 나간다(사용자 결정)
    expect(row!.entryParams).toEqual({ euid: 'panel-77' });
  });

  it('허용한 게스트의 분할 파일도 같은 가리기를 거친다', async () => {
    authState.user = { id: GUEST9 };
    const { buildSplitWorkbook } = await import('@/lib/analytics/split-workbook');
    vi.mocked(buildSplitWorkbook).mockClear();
    await exportGet(requestOf(AI_2026_PUBLIC, 'type=raw-split&basis=q-info'), paramsOf(AI_2026_PUBLIC));
    expect(loaderOptions()['maskAnswers']).toEqual(expect.any(Function));
    const rows = vi.mocked(buildSplitWorkbook).mock.calls[0]?.[1] as unknown as (typeof ROW)[];
    expect(rows?.[0]?.contactValues).toEqual({ 'attrs.기수': '3기', 'pii.성명': '김영*' });
  });

  it('관리자가 받는 파일은 평문 그대로다', async () => {
    authState.user = { id: 'admin' };
    const res = await exportGet(requestOf(AI_2026_PUBLIC, 'type=raw'), paramsOf(AI_2026_PUBLIC));
    expect(res.status).toBe(200);
    expect(workbookRows()[0]).toBe(ROW);
    expect(loaderOptions()).not.toHaveProperty('maskAnswers');
  });
});
