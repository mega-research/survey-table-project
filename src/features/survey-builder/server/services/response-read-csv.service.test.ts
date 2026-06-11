import { beforeEach, describe, expect, it, vi } from 'vitest';

// exportResponsesAsCsv 의 셀 포맷 로직 회귀 테스트.
// 핵심: questionResponses 값이 명시적 null 이면 "null" 문자열이 아니라 빈 셀이 되어야 한다
// (typeof null === 'object' 함정). DB 는 db.query.surveyResponses.findMany 만 모킹한다.

const findMany = vi.fn();

vi.mock('@/db', () => ({
  db: {
    query: {
      surveyResponses: {
        findMany: (...args: unknown[]) => findMany(...args),
      },
    },
  },
}));

import { exportResponsesAsCsv } from './response-read.service';

const SURVEY_ID = 'survey-1';

type FakeResponse = {
  id: string;
  startedAt: Date;
  completedAt: Date;
  questionResponses: Record<string, unknown>;
};

function fakeResponse(questionResponses: Record<string, unknown>): FakeResponse {
  return {
    id: 'resp-1',
    startedAt: new Date('2026-06-01T00:00:00.000Z'),
    completedAt: new Date('2026-06-01T00:01:00.000Z'),
    questionResponses,
  };
}

// CSV 한 행을 셀 배열로 되돌린다(따옴표 escape 복원).
// 각 셀은 "..." 로 감싸이고 ',' 로 join 되며 내부 " 는 "" 로 escape 된다.
function parseRow(line: string | undefined): string[] {
  if (line === undefined) throw new Error('CSV 행이 없습니다');
  return line
    .slice(1, -1) // 양끝 따옴표 제거
    .split('","')
    .map((c) => c.replace(/""/g, '"'));
}

describe('exportResponsesAsCsv 셀 포맷', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('명시적 null 값은 "null" 이 아니라 빈 셀로 내보낸다', async () => {
    findMany.mockResolvedValue([fakeResponse({ q1: null })]);

    const csv = await exportResponsesAsCsv(SURVEY_ID);
    const lines = csv.split('\n');
    const dataCells = parseRow(lines[1]);

    // [응답 ID, 시작, 완료, 완료(분), q1]
    expect(dataCells[4]).toBe('');
    expect(csv).not.toContain('null');
  });

  it('undefined 값도 빈 셀로 내보낸다', async () => {
    // q2 헤더는 다른 응답에서 생기고, 현재 응답엔 q2 키가 없어 undefined 가 된다.
    findMany.mockResolvedValue([
      fakeResponse({ q1: 'a' }),
      { ...fakeResponse({ q2: 'b' }), id: 'resp-2' },
    ]);

    const csv = await exportResponsesAsCsv(SURVEY_ID);
    const lines = csv.split('\n');
    const headerCells = parseRow(lines[0]);
    const q1Idx = headerCells.indexOf('q1');
    const q2Idx = headerCells.indexOf('q2');
    const row1 = parseRow(lines[1]);

    expect(row1[q1Idx]).toBe('a');
    expect(row1[q2Idx]).toBe('');
  });

  it('배열/객체/문자열 값은 기존 포맷을 유지한다', async () => {
    findMany.mockResolvedValue([
      fakeResponse({ arr: ['x', 'y'], obj: { k: 1 }, str: 'hello' }),
    ]);

    const csv = await exportResponsesAsCsv(SURVEY_ID);
    const lines = csv.split('\n');
    const headerCells = parseRow(lines[0]);
    const row1 = parseRow(lines[1]);

    expect(row1[headerCells.indexOf('arr')]).toBe('x; y');
    expect(row1[headerCells.indexOf('obj')]).toBe('{"k":1}');
    expect(row1[headerCells.indexOf('str')]).toBe('hello');
  });
});
