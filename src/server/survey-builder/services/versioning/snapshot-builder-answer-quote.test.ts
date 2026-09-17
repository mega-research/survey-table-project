import { describe, expect, it } from 'vitest';
import { buildSurveySnapshot } from './snapshot-builder';
import { PERSISTED_QUESTION_FIELDS } from '@/db/schema/question-persisted-fields';
import type { Survey } from '@/types/survey';

const baseSurvey = (overrides: Partial<Survey['questions'][number]>): Survey =>
  ({
    id: 's1',
    title: '설문',
    questions: [
      {
        id: 'q1',
        surveyId: 's1',
        type: 'radio',
        title: '마케팅을 수행합니까',
        required: false,
        order: 0,
        options: [
          { id: 'o1', label: '수행', value: '1', answerQuoteText: '디지털마케팅 전략' },
          { id: 'o2', label: '미수행', value: '2' },
        ],
        ...overrides,
      },
    ],
    groups: [],
    settings: {
      isPublic: true,
      allowMultipleResponses: false,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '감사합니다',
    },
    lookups: [],
  }) as unknown as Survey;

describe('응답 인용 필드의 스냅샷 보존', () => {
  it('질문 단위 인용 필드가 스냅샷에 실린다', () => {
    const snap = buildSurveySnapshot(
      baseSurvey({ answerQuoteEnabled: true, answerQuoteName: '마케팅유형' }),
    );
    expect(snap.questions[0]?.answerQuoteEnabled).toBe(true);
    expect(snap.questions[0]?.answerQuoteName).toBe('마케팅유형');
  });

  it('옵션 단위 인용 문구가 스냅샷에 실린다', () => {
    const snap = buildSurveySnapshot(
      baseSurvey({ answerQuoteEnabled: true, answerQuoteName: '마케팅유형' }),
    );
    expect(snap.questions[0]?.options?.[0]?.answerQuoteText).toBe('디지털마케팅 전략');
  });

  it('영속 필드 SSOT 에 인용 컬럼 3개가 등재되어 있다', () => {
    expect(PERSISTED_QUESTION_FIELDS).toContain('answerQuoteEnabled');
    expect(PERSISTED_QUESTION_FIELDS).toContain('answerQuoteName');
    expect(PERSISTED_QUESTION_FIELDS).toContain('answerQuoteText');
  });
});
