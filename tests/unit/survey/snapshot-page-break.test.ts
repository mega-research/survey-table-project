import { describe, expect, it } from 'vitest';
import { buildSurveySnapshot } from '@/lib/versioning/snapshot-builder';
import type { Survey } from '@/types/survey';

function minimalSurvey(pageBreakBefore: boolean): Survey {
  return {
    id: 's1',
    title: '설문',
    questions: [
      { id: 'q1', type: 'radio', title: 'Q1', required: false, order: 0 },
      { id: 'q2', type: 'radio', title: 'Q2', required: false, order: 1, pageBreakBefore },
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
  } as unknown as Survey;
}

describe('스냅샷이 pageBreakBefore를 보존한다', () => {
  it('pageBreakBefore=true 질문이 스냅샷에 실린다', () => {
    const snap = buildSurveySnapshot(minimalSurvey(true));
    const q2 = snap.questions.find((q) => q.id === 'q2');
    expect(q2?.pageBreakBefore).toBe(true);
  });

  it('pageBreakBefore 미설정은 스냅샷에서 undefined', () => {
    const snap = buildSurveySnapshot(minimalSurvey(false));
    const q1 = snap.questions.find((q) => q.id === 'q1');
    expect(q1?.pageBreakBefore).toBeUndefined();
  });
});
