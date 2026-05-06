import { describe, expect, it } from 'vitest';

import type { Question, SurveySubmission } from '@/types/survey';

import {
  generateSPSSColumns,
  buildDataRows,
  type SPSSExportColumn,
} from '@/lib/analytics/spss-excel-export';

function makeQuestion(
  overrides: Partial<Question> & { type: Question['type']; order: number },
): Question {
  return {
    id: `q-${overrides.order}`,
    title: `문제${overrides.order}`,
    required: false,
    ...overrides,
  } as Question;
}

function makeSubmission(
  questionResponses: Record<string, any>,
  overrides?: Partial<SurveySubmission>,
): SurveySubmission {
  return {
    id: 'sub-1',
    surveyId: 'survey-1',
    startedAt: new Date('2025-01-01T09:00:00'),
    completedAt: new Date('2025-01-01T09:10:00'),
    isCompleted: true,
    currentGroupOrder: 0,
    questionResponses,
    updatedAt: new Date('2025-01-01T09:10:00'),
    ...overrides,
  };
}

const sampleQuestions: Question[] = [
  makeQuestion({
    type: 'radio',
    order: 1,
    id: 'q-gender',
    questionCode: 'Q1',
    title: '성별',
    options: [
      { id: 'o-male', label: '남성', value: 'o-male', spssNumericCode: 1 },
      { id: 'o-female', label: '여성', value: 'o-female', spssNumericCode: 2 },
    ],
  }),
  makeQuestion({
    type: 'checkbox',
    order: 2,
    id: 'q-products',
    questionCode: 'Q2',
    title: '생산품목',
    options: [
      { id: 'o-wood', label: '제제목', value: 'o-wood', spssNumericCode: 1 },
      { id: 'o-plywood', label: '합판', value: 'o-plywood', spssNumericCode: 2 },
      { id: 'o-fiber', label: '섬유판', value: 'o-fiber', spssNumericCode: 3 },
    ],
  }),
  makeQuestion({
    type: 'text',
    order: 3,
    id: 'q-opinion',
    questionCode: 'Q3',
    title: '기타 의견',
  }),
];

describe('generateSPSSColumns', () => {
  it('단일선택 질문은 열 1개를 생성한다', () => {
    const columns = generateSPSSColumns([sampleQuestions[0]]);
    expect(columns).toHaveLength(1);
    expect(columns[0].spssVarName).toBe('Q1');
    expect(columns[0].type).toBe('single');
  });

  it('복수선택 질문은 옵션 수만큼 열을 생성한다', () => {
    const columns = generateSPSSColumns([sampleQuestions[1]]);
    expect(columns).toHaveLength(3);
    expect(columns[0].spssVarName).toBe('Q2_1');
    expect(columns[1].spssVarName).toBe('Q2_2');
    expect(columns[2].spssVarName).toBe('Q2_3');
    expect(columns[0].type).toBe('checkbox-item');
  });

  it('텍스트 질문은 열 1개를 생성한다', () => {
    const columns = generateSPSSColumns([sampleQuestions[2]]);
    expect(columns).toHaveLength(1);
    expect(columns[0].spssVarName).toBe('Q3');
    expect(columns[0].type).toBe('text');
  });

  it('notice 질문은 제외한다', () => {
    const questions = [makeQuestion({ type: 'notice', order: 1 })];
    const columns = generateSPSSColumns(questions);
    expect(columns).toHaveLength(0);
  });

  it('여러 질문을 순서대로 열 정의를 생성한다', () => {
    const columns = generateSPSSColumns(sampleQuestions);
    // Q1(1) + Q2_1~Q2_3(3) + Q3(1) = 5열
    expect(columns).toHaveLength(5);
    expect(columns.map((c) => c.spssVarName)).toEqual([
      'Q1', 'Q2_1', 'Q2_2', 'Q2_3', 'Q3',
    ]);
  });

  it('옵션 라벨을 포함한다', () => {
    const columns = generateSPSSColumns(sampleQuestions);
    // radio는 모든 옵션을 "1. 남성 / 2. 여성" 형태로
    expect(columns[0].optionLabel).toContain('남성');
    // checkbox는 개별 옵션 라벨
    expect(columns[1].optionLabel).toContain('제제목');
    expect(columns[2].optionLabel).toContain('합판');
  });
});

describe('buildDataRows', () => {
  it('단일선택 응답을 숫자코드로 변환한다', () => {
    const columns = generateSPSSColumns([sampleQuestions[0]]);
    const submissions = [makeSubmission({ 'q-gender': 'o-male' })];
    const rows = buildDataRows(columns, [sampleQuestions[0]], submissions);
    expect(rows[0][0]).toBe(1);
  });

  it('복수선택 응답을 옵션별 분리한다', () => {
    const columns = generateSPSSColumns([sampleQuestions[1]]);
    const submissions = [
      makeSubmission({ 'q-products': ['o-wood', 'o-fiber'] }),
    ];
    const rows = buildDataRows(columns, [sampleQuestions[1]], submissions);
    expect(rows[0]).toEqual([1, null, 3]); // 제제목=1, 합판=null, 섬유판=3
  });

  it('텍스트 응답을 그대로 유지한다', () => {
    const columns = generateSPSSColumns([sampleQuestions[2]]);
    const submissions = [makeSubmission({ 'q-opinion': '좋았습니다' })];
    const rows = buildDataRows(columns, [sampleQuestions[2]], submissions);
    expect(rows[0][0]).toBe('좋았습니다');
  });

  it('미응답은 null로 처리한다', () => {
    const columns = generateSPSSColumns([sampleQuestions[0]]);
    const submissions = [makeSubmission({})];
    const rows = buildDataRows(columns, [sampleQuestions[0]], submissions);
    expect(rows[0][0]).toBeNull();
  });

  it('여러 응답자의 데이터를 행으로 반환한다', () => {
    const columns = generateSPSSColumns([sampleQuestions[0]]);
    const submissions = [
      makeSubmission({ 'q-gender': 'o-male' }),
      makeSubmission({ 'q-gender': 'o-female' }, { id: 'sub-2' }),
    ];
    const rows = buildDataRows(columns, [sampleQuestions[0]], submissions);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe(1);
    expect(rows[1][0]).toBe(2);
  });
});

