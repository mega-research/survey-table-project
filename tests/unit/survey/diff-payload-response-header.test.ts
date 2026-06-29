import { describe, expect, it } from 'vitest';

import { buildSurveyDiffPayload } from '@/lib/survey-builder/diff-payload';
import type { Survey } from '@/types/survey';

const baseSurvey: Survey = {
  id: 'survey-1',
  title: '설문',
  description: '',
  questions: [],
  groups: [],
  settings: {
    isPublic: true,
    allowMultipleResponses: false,
    showProgressBar: true,
    shuffleQuestions: false,
    requireLogin: false,
    thankYouMessage: '감사합니다',
    responseHeader: {
      style: 'logo-title',
      titleSize: 'lg',
      logo: {
        imageUrl: 'https://example.com/logo.png',
        size: 'md',
      },
      logoTitle: {
        logoPosition: 'right',
      },
    },
  },
  createdAt: new Date('2026-06-29T00:00:00.000Z'),
  updatedAt: new Date('2026-06-29T00:00:00.000Z'),
};

describe('buildSurveyDiffPayload responseHeader', () => {
  it('메타데이터 dirty 저장 payload에 settings.responseHeader를 포함한다', () => {
    const payload = buildSurveyDiffPayload(baseSurvey, {
      isMetadataDirty: true,
      questionChanges: {
        added: {},
        updated: {},
        deleted: {},
        reordered: false,
      },
    });

    expect(payload?.metadata?.settings.responseHeader).toEqual(baseSurvey.settings.responseHeader);
  });
});
