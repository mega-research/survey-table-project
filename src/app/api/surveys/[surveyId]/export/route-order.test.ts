import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { NextRequest } from 'next/server';

// export/route.ts 와 split-preview/route.ts 가 questions 조회에 order 오름차순
// orderBy 를 넘기는지 검증한다. 두 라우트는 동일한
//   db.query.surveys.findFirst({ where, with: { questions: { orderBy } } })
// 패턴을 공유하며, orderBy 가 없으면 변수 순서가 Postgres 힙 순서를 따른다.
//
// findFirst 는 undefined 를 반환해 라우트를 즉시 404 로 끝내되(다운스트림 불필요),
// 호출 인자에 담긴 orderBy 콜백을 fake operators 로 실행해 asc(order) 를 단언한다.

const { authState, mockFindFirst } = vi.hoisted(() => ({
  authState: { user: null as null | { id: string } },
  mockFindFirst: vi.fn(),
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
    query: { surveys: { findFirst: mockFindFirst }, surveyResponses: { findMany: vi.fn() } },
    select: vi.fn(),
  },
}));

vi.mock('@/db/schema', () => ({
  surveys: { id: 'surveys.id' },
  surveyResponses: { surveyId: 'survey_responses.survey_id', deletedAt: 'deleted_at', status: 'status' },
  contactTargets: { id: 'contact_targets.id', resid: 'resid', groupValue: 'group_value' },
}));

vi.mock('@/lib/analytics/raw-workbook', () => ({ generateRawDataWorkbook: vi.fn() }));
vi.mock('@/lib/analytics/split-workbook', () => ({ buildSplitWorkbook: vi.fn() }));

import { GET as exportGet } from '@/app/api/surveys/[surveyId]/export/route';
import { GET as previewGet } from '@/app/api/surveys/[surveyId]/export/split-preview/route';

// orderBy 콜백을 실제 drizzle 없이 실행하기 위한 fake operators/columns.
type OrderBy = (columns: { order: unknown }, ops: { asc: (col: unknown) => unknown }) => unknown;
function assertOrdersByQuestionOrderAsc(orderBy: unknown) {
  expect(typeof orderBy).toBe('function');
  const asc = (col: unknown) => ({ col, dir: 'asc' as const });
  const result = (orderBy as OrderBy)({ order: 'ORDER_COLUMN' }, { asc });
  expect(result).toEqual([{ col: 'ORDER_COLUMN', dir: 'asc' }]);
}

describe('export 라우트 questions 조회는 order 오름차순으로 정렬한다', () => {
  beforeEach(() => {
    authState.user = { id: 'admin' };
    mockFindFirst.mockReset();
    mockFindFirst.mockResolvedValue(undefined); // → 404, 인자만 캡처
    delete process.env['ADMIN_USER_IDS'];
  });

  afterEach(() => {
    delete process.env['ADMIN_USER_IDS'];
  });

  it('GET /export 는 with.questions.orderBy = asc(order)', async () => {
    const request = new NextRequest('http://localhost/api/surveys/s1/export?type=sav');
    const response = await exportGet(request, { params: Promise.resolve({ surveyId: 's1' }) });

    expect(response.status).toBe(404);
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    const args = mockFindFirst.mock.calls[0]![0] as { with?: { questions?: { orderBy?: unknown } } };
    assertOrdersByQuestionOrderAsc(args?.with?.questions?.orderBy);
  });

  it('GET /export/split-preview 는 with.questions.orderBy = asc(order)', async () => {
    const request = new NextRequest('http://localhost/api/surveys/s1/export/split-preview');
    const response = await previewGet(request, { params: Promise.resolve({ surveyId: 's1' }) });

    expect(response.status).toBe(404);
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    const args = mockFindFirst.mock.calls[0]![0] as { with?: { questions?: { orderBy?: unknown } } };
    assertOrdersByQuestionOrderAsc(args?.with?.questions?.orderBy);
  });
});
