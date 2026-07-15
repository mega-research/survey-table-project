import { describe, expect, it } from 'vitest';

import { buildSurveySnapshot } from '@/lib/versioning/snapshot-builder';
import type { Question, Survey } from '@/types/survey';

describe('버전 스냅샷 — 숫자 검증 신규 필드 관통', () => {
  it('numberFormat 과 sumConstraints 가 스냅샷에 보존된다', () => {
    const question = {
      id: 'q1',
      type: 'text',
      title: '단답',
      required: false,
      order: 0,
      inputType: 'number',
      numberFormat: { thousandSeparator: true, unit: 'tenMillion', max: 100 },
      sumConstraints: [{ id: 's1', cellIds: ['c1'], operator: 'eq', target: 100 }],
    } as Question;
    const survey = {
      id: 'sv1',
      title: '설문',
      questions: [question],
      groups: [],
      settings: {
        isPublic: true,
        allowMultipleResponses: false,
        showProgressBar: true,
        shuffleQuestions: false,
        requireLogin: false,
        thankYouMessage: '감사합니다',
      },
    } as unknown as Survey;

    const snapshot = buildSurveySnapshot(survey);
    expect(snapshot.questions[0]!.numberFormat).toMatchObject({ unit: 'tenMillion' });
    expect(snapshot.questions[0]!.sumConstraints).toHaveLength(1);
  });
});
