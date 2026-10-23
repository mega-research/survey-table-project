import { describe, expect, it } from 'vitest';

import { analyzeSurvey } from '@/lib/analytics/analyzer';
import type { SurveyResponse } from '@/db/schema';
import type { Question } from '@/types/survey';

// 분석 화면은 응답 원본(question_responses JSONB)을 그대로 읽는다. 원본에는 문항이 아닌 루트
// 사이드카(__optTexts__ · __changeConfirm__ …)와 지금 설문에 없는 문항의 키가 섞여 있다.
// 문항별로 저장한 사본(response_answers, 2026-10-23 제거)은 그 키를 걸러 냈으므로, 분석기가
// 그 키에 흔들리지 않아야 사본을 걷어도 결과가 같다.
function makeResponse(id: string, questionResponses: Record<string, unknown>): SurveyResponse {
  return {
    id,
    startedAt: new Date('2026-10-22T01:00:00Z'),
    completedAt: new Date('2026-10-22T01:10:00Z'),
    isCompleted: true,
    totalSeconds: 600,
    metadata: null,
    questionResponses,
  } as unknown as SurveyResponse;
}

const questions = [
  {
    id: 'q-radio',
    type: 'radio',
    title: '단일 선택',
    required: false,
    order: 0,
    options: [
      { id: 'o1', label: '하나', value: '1' },
      { id: 'o2', label: '둘', value: '2' },
    ],
  },
  {
    id: 'q-check',
    type: 'checkbox',
    title: '복수 선택',
    required: false,
    order: 1,
    options: [
      { id: 'c1', label: '가', value: 'a' },
      { id: 'c2', label: '나', value: 'b' },
    ],
  },
  { id: 'q-text', type: 'text', title: '단답', required: false, order: 2 },
] as unknown as Question[];

const survey = { id: 'survey-1', title: '제목', questions };

describe('analyzeSurvey 는 문항이 아닌 키에 흔들리지 않는다', () => {
  it('사이드카 · 지금 없는 문항 키가 섞인 원본과 문항 키만 남긴 사본의 분석 결과가 같다', () => {
    const answers = { 'q-radio': '2', 'q-check': ['a', 'b'], 'q-text': '메모' };
    const fromCopy = analyzeSurvey(survey, [makeResponse('r1', answers)]);
    const fromOriginal = analyzeSurvey(survey, [
      makeResponse('r1', {
        ...answers,
        __optTexts__: { 'q-radio': { o2: '기타 내용' } },
        __changeConfirm__: { 'q-text': 'same' },
        'deleted-question-id': '3',
      }),
    ]);

    expect(fromOriginal).toEqual(fromCopy);
  });
});
