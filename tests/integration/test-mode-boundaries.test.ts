import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authState,
  surveyFindFirstMock,
  responseFindManyMock,
  responseWhereArgs,
  selectWhereArgs,
} = vi.hoisted(() => ({
  authState: { user: { id: 'admin' } as null | { id: string } },
  surveyFindFirstMock: vi.fn(),
  responseFindManyMock: vi.fn(),
  responseWhereArgs: [] as unknown[],
  selectWhereArgs: [] as unknown[],
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
    query: {
      surveys: { findFirst: surveyFindFirstMock },
      surveyResponses: {
        findMany: responseFindManyMock,
      },
    },
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: (where: unknown) => {
          selectWhereArgs.push(where);
          return Promise.resolve([{ total: 0 }]);
        },
      };
      return chain;
    }),
  },
}));

vi.mock('@/lib/analytics/raw-workbook', () => ({
  generateRawDataWorkbook: vi.fn(() => ({
    xlsx: { writeBuffer: vi.fn(async () => new ArrayBuffer(0)) },
  })),
}));

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
import { getCompletedResponses } from '@/data/responses';
import { getResponseSummary } from '@/features/analytics/server/services/analytics.service';
import {
  campaignScopeCondition,
  responseScopeCondition,
  targetScopeCondition,
} from '@/lib/operations/data-scope.server';

const dialect = new PgDialect();
const surveyId = 'survey-boundary';

function expectRealOnly(where: unknown) {
  const query = dialect.sqlToQuery(where as never);
  expect(query.sql).toContain('is_test');
  expect(query.params).toContain(false);
}

beforeEach(() => {
  delete process.env['ADMIN_USER_IDS'];
  authState.user = { id: 'admin' };
  responseWhereArgs.length = 0;
  selectWhereArgs.length = 0;
  responseFindManyMock.mockReset();
  responseFindManyMock.mockImplementation(async (options?: { where?: unknown }) => {
    if (options?.where) responseWhereArgs.push(options.where);
    return [];
  });
  surveyFindFirstMock.mockReset();
  surveyFindFirstMock.mockResolvedValue({
    id: surveyId,
    title: '경계 설문',
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

describe('테스트 모드 최종 읽기 경계', () => {
  it('SPSS·Excel·split preview는 모두 실제 응답 조건을 쿼리에 유지한다', async () => {
    const sav = await exportGet(
      new NextRequest(`http://localhost/api/surveys/${surveyId}/export?type=sav`),
      { params: Promise.resolve({ surveyId }) },
    );
    const raw = await exportGet(
      new NextRequest(`http://localhost/api/surveys/${surveyId}/export?type=raw`),
      { params: Promise.resolve({ surveyId }) },
    );
    const preview = await splitPreviewGet(
      new NextRequest(
        `http://localhost/api/surveys/${surveyId}/export/split-preview?basis=basis`,
      ),
      { params: Promise.resolve({ surveyId }) },
    );

    expect([sav.status, raw.status, preview.status]).toEqual([200, 200, 200]);
    expect(responseWhereArgs).toHaveLength(3);
    responseWhereArgs.forEach(expectRealOnly);
    expect(selectWhereArgs).toHaveLength(1);
    selectWhereArgs.forEach(expectRealOnly);
  });

  it('analytics와 공용 완료 응답 조회는 mode와 무관하게 실제 응답만 읽는다', async () => {
    await getCompletedResponses(surveyId);
    await getResponseSummary(surveyId);

    expect(responseWhereArgs).toHaveLength(2);
    responseWhereArgs.forEach(expectRealOnly);
  });

  it.each([
    ['response', responseScopeCondition],
    ['target', targetScopeCondition],
    ['campaign', campaignScopeCondition],
  ] as const)('%s 운영 범위는 real=false, test=true로 닫힌다', (_name, condition) => {
    const real = dialect.sqlToQuery(condition('real'));
    const test = dialect.sqlToQuery(condition('test'));

    expect(real.params).toEqual([false]);
    expect(test.params).toEqual([true]);
  });
});
