import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import type { Question, Survey } from '@/types/survey';

/**
 * 조사표(PDF)를 끼고 답하는 설문은 머리 부분에 "N / M 페이지" 위치 표시를 두지 않는다
 * (2026-09-01 운영 요청). 분할 레이아웃은 진행바도 없으므로 페이지 수는 어디에도 나오지 않는다.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// 조사표 판(PDF.js)은 jsdom 에서 열 수 없다 — 머리 부분만 보는 테스트라 빈 판으로 대체.
vi.mock('@/components/survey-document/response-document-pane', () => ({
  ResponseDocumentPane: () => <div data-testid="document-pane" />,
}));

function buildSurvey(questions: Question[]): Survey {
  return {
    id: 'document-survey',
    title: '조사표 설문',
    status: 'published',
    currentVersionId: 'version-1',
    groups: [],
    questions,
    settings: {
      isPublic: true,
      allowMultipleResponses: true,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '감사합니다.',
      requireInviteToken: false,
    },
    lookups: [],
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
  } as Survey;
}

describe('조사표 설문 머리 부분', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it('"N / M 페이지" 위치 표시를 두지 않는다', async () => {
    const survey = buildSurvey([
      { id: 'q1', type: 'text', title: '첫 질문', description: '', required: false, order: 0 },
    ]);
    render(
      <SurveyResponseFlow
        mode="preview"
        surveyIdentifier="preview-document-survey"
        previewContext={{
          survey,
          versionId: 'version-1',
          documentView: {
            url: 'https://example.test/doc.pdf',
            pageCount: 3,
            anchors: [{ ownerKind: 'question', ownerId: 'q1', page: 1, x: 0, y: 0, w: 1, h: 1 }],
          },
        }}
      />,
    );

    await screen.findByText('첫 질문');
    expect(screen.getByTestId('document-pane')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ \/ \d+ 페이지/)).toBeNull();
  });
});
