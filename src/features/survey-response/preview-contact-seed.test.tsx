import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';
import type { Question, Survey } from '@/types/survey';

import { stubMatchMedia } from '../../../tests/helpers/image-size';

/**
 * 관리자 「설문 보기」가 첫 번째 조사 대상의 명단 값·이월 응답으로 열린다(.scratch/preview-first-contact/PRD.md).
 * 페이지가 previewContext 에 실어 보낸 값이 로더의 어느 state 에도 안 들어가면 타입은 통과하고 화면만 빈다 —
 * 그래서 플로우를 끝까지 렌더해 토큰 치환과 이월 프리필이 화면에 닿는지 본다.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

let restoreMatchMedia: (() => void) | undefined;
afterEach(() => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
  useSurveyResponseStore.getState().resetResponseState();
});

function buildSurvey(questions: Question[]): Survey {
  return {
    id: 'preview-contact-seed',
    title: '설문 보기 명단 값',
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
    createdAt: new Date('2026-11-04T00:00:00.000Z'),
    updatedAt: new Date('2026-11-04T00:00:00.000Z'),
  } as Survey;
}

const questions: Question[] = [
  { id: 'q-notice', type: 'notice', title: '안내', noticeContent: '<p>{{업체명 || DQ2}} 담당자님</p>', required: false, order: 0 },
  { id: 'q-sales', type: 'text', title: '작년 매출', required: false, order: 1 },
];

function renderPreview(extra: { contactAttrs?: Record<string, string>; priorAnswers?: Record<string, unknown> | null }) {
  restoreMatchMedia = stubMatchMedia({ mobile: false, hover: true });
  render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier="preview-contact-seed"
      previewContext={{ survey: buildSurvey(questions), versionId: 'version-1', ...extra }}
    />,
  );
}

describe('설문 보기 — 첫 번째 조사 대상의 값', () => {
  it('명단 값으로 토큰을 치환하고 이월 응답을 입력칸에 깐다', async () => {
    renderPreview({ contactAttrs: { DQ2: '동남종합상사' }, priorAnswers: { 'q-sales': '1200' } });
    expect(await screen.findByText(/동남종합상사 담당자님/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('1200'));
  });

  it('「이월값 불러오기」를 끈 문항에는 깔지 않는다 — 공개 경로와 같은 적재', async () => {
    restoreMatchMedia = stubMatchMedia({ mobile: false, hover: true });
    render(
      <SurveyResponseFlow
        mode="preview"
        surveyIdentifier="preview-contact-seed"
        previewContext={{
          survey: buildSurvey([questions[0]!, { ...questions[1]!, priorAnswerDisabled: true } as Question]),
          versionId: 'version-1',
          contactAttrs: { DQ2: '동남종합상사' },
          priorAnswers: { 'q-sales': '1200' },
        }}
      />,
    );
    expect(await screen.findByText(/동남종합상사 담당자님/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('값을 싣지 않으면 종전처럼 빈 명단 값으로 열린다', async () => {
    renderPreview({});
    expect(await screen.findByText(/담당자님/)).toBeInTheDocument();
    expect(screen.queryByText(/동남종합상사/)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
