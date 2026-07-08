import { describe, it, expect, vi, beforeEach } from 'vitest';

// getSurveyWithDetails 의 row→Question 명시 매핑이 pageBreakBefore 를 보존하는지 검증.
// 이 매핑이 필드를 떨구면 publish 스냅샷·빌더 리로드에서 페이지 구분점이 소실된다.
const { mockSurveyFindFirst, mockGroupsFindMany, mockQuestionsFindMany } = vi.hoisted(() => ({
  mockSurveyFindFirst: vi.fn(),
  mockGroupsFindMany: vi.fn(),
  mockQuestionsFindMany: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    query: {
      surveys: { findFirst: mockSurveyFindFirst },
      questionGroups: { findMany: mockGroupsFindMany },
      questions: { findMany: mockQuestionsFindMany },
    },
  },
}));

function questionRow(overrides: Record<string, unknown>) {
  return {
    id: 'q',
    type: 'radio',
    title: '질문',
    required: false,
    order: 0,
    ...overrides,
  };
}

describe('getSurveyWithDetails — pageBreakBefore 매핑', () => {
  beforeEach(() => {
    mockSurveyFindFirst.mockReset();
    mockGroupsFindMany.mockReset();
    mockQuestionsFindMany.mockReset();
    mockSurveyFindFirst.mockResolvedValue({ id: 's1', title: '설문' });
    mockGroupsFindMany.mockResolvedValue([]);
  });

  it('page_break_before=true 인 질문 행이 pageBreakBefore 로 매핑된다', async () => {
    mockQuestionsFindMany.mockResolvedValue([
      questionRow({ id: 'q1', order: 0 }),
      questionRow({ id: 'q2', order: 1, pageBreakBefore: true }),
    ]);
    const { getSurveyWithDetails } = await import('@/data/surveys');
    const survey = await getSurveyWithDetails('s1');
    expect(survey?.questions.find((q) => q.id === 'q2')?.pageBreakBefore).toBe(true);
  });

  it('false 값도 그대로 보존된다', async () => {
    mockQuestionsFindMany.mockResolvedValue([
      questionRow({ id: 'q1', order: 0, pageBreakBefore: false }),
    ]);
    const { getSurveyWithDetails } = await import('@/data/surveys');
    const survey = await getSurveyWithDetails('s1');
    expect(survey?.questions[0]?.pageBreakBefore).toBe(false);
  });
});
