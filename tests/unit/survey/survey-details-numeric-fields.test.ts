import { describe, it, expect, vi, beforeEach } from 'vitest';

// getSurveyWithDetails 의 row→Question 명시 매핑이 numberFormat·sumConstraints 를 보존하는지 검증.
// 이 매핑이 필드를 떨구면 publish 스냅샷 부재, 빌더 리로드 후 설정 소멸, 재저장 upsert 의
// DB 값 NULL 덮어쓰기(데이터 소실)로 이어진다 — pageBreakBefore 매핑 회귀 테스트와 동일 패턴.
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

describe('getSurveyWithDetails — numberFormat·sumConstraints 매핑', () => {
  beforeEach(() => {
    mockSurveyFindFirst.mockReset();
    mockGroupsFindMany.mockReset();
    mockQuestionsFindMany.mockReset();
    mockSurveyFindFirst.mockResolvedValue({ id: 's1', title: '설문' });
    mockGroupsFindMany.mockResolvedValue([]);
  });

  it('numberFormat 이 있는 단답형 질문 행이 numberFormat 으로 매핑된다', async () => {
    mockQuestionsFindMany.mockResolvedValue([
      questionRow({
        id: 'q1',
        type: 'text',
        order: 0,
        inputType: 'number',
        numberFormat: { thousandSeparator: true, unit: 'tenMillion', max: 100 },
      }),
    ]);
    const { getSurveyWithDetails } = await import('@/data/surveys');
    const survey = await getSurveyWithDetails('s1');
    expect(survey?.questions[0]?.numberFormat).toMatchObject({ unit: 'tenMillion', max: 100 });
  });

  it('sumConstraints 가 있는 테이블 질문 행이 sumConstraints 로 매핑된다', async () => {
    mockQuestionsFindMany.mockResolvedValue([
      questionRow({
        id: 'q2',
        type: 'table',
        order: 0,
        sumConstraints: [{ id: 's1', cellIds: ['c1', 'c2'], operator: 'eq', target: 100 }],
      }),
    ]);
    const { getSurveyWithDetails } = await import('@/data/surveys');
    const survey = await getSurveyWithDetails('s1');
    expect(survey?.questions[0]?.sumConstraints).toHaveLength(1);
    expect(survey?.questions[0]?.sumConstraints?.[0]).toMatchObject({ operator: 'eq', target: 100 });
  });

  it('두 필드가 null 이면 매핑 결과에서 생략된다 (다른 nullable 필드와 동일 패턴)', async () => {
    mockQuestionsFindMany.mockResolvedValue([
      questionRow({ id: 'q3', order: 0, numberFormat: null, sumConstraints: null }),
    ]);
    const { getSurveyWithDetails } = await import('@/data/surveys');
    const survey = await getSurveyWithDetails('s1');
    expect(survey?.questions[0]).not.toHaveProperty('numberFormat');
    expect(survey?.questions[0]).not.toHaveProperty('sumConstraints');
  });
});
