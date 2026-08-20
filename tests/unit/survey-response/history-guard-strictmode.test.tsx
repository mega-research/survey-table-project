import { StrictMode } from 'react';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import type { Question, Survey } from '@/types/survey';

/**
 * 뒤로가기 가드 effect 의 StrictMode 중복 push 회귀 테스트.
 *
 * effect 본문이 실행마다 history.pushState 를 호출하고 cleanup 은 리스너만 제거하므로,
 * StrictMode(dev)의 이중 실행이 같은 스텝 엔트리를 2개 쌓아 첫 뒤로가기 1회가
 * 무반응(중복 엔트리 pop 에 소모)이 됐다. 현재 history.state 가 이미 이 스텝이면
 * push 를 생략해 실행 횟수와 무관하게 스텝당 엔트리 1개를 보장한다.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function buildSurvey(questions: Question[]): Survey {
  return {
    id: 'history-guard-survey',
    title: '히스토리 가드 검증',
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

describe('뒤로가기 가드 — StrictMode 이중 실행', () => {
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

  it('마운트 시 스텝 엔트리를 정확히 1개만 쌓는다', async () => {
    const survey = buildSurvey([
      {
        id: 'q1',
        type: 'text',
        title: '첫 질문',
        description: '',
        required: false,
        order: 0,
      },
    ]);

    const lengthBefore = window.history.length;
    render(
      <StrictMode>
        <SurveyResponseFlow
          mode="preview"
          surveyIdentifier="preview-history-guard"
          previewContext={{ survey, versionId: 'version-1' }}
        />
      </StrictMode>,
    );
    await screen.findByText('첫 질문');

    expect(window.history.length - lengthBefore).toBe(1);
  });
});
