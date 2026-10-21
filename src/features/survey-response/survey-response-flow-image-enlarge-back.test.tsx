import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import type { Question, Survey } from '@/types/survey';

import { loadImageWithSize, stubMatchMedia } from '../../../tests/helpers/image-size';

/**
 * 「이미지 크게 보기」를 뒤로 가기로 닫는다 — 응답 흐름은 페이지마다 방문 기록 칸을 쌓고 뒤로 가기마다
 * 이전 페이지로 가므로, 크게 보기가 쌓은 칸을 걷을 때 페이지가 넘어가면 안 된다.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

let restoreMatchMedia: (() => void) | undefined;

afterEach(() => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
});

const IMAGE_URL = 'https://cdn.example.com/a.png';

function buildSurvey(): Survey {
  const questions: Question[] = [
    { id: 'q1', type: 'text', title: '첫 페이지 질문', required: false, order: 0 },
    {
      id: 'q2',
      type: 'table',
      title: '둘째 페이지 표',
      required: false,
      order: 1,
      pageBreakBefore: true,
      tableColumns: [
        { id: 'col-name', label: '시안' },
        { id: 'col-image', label: '이미지' },
      ],
      tableRowsData: [
        {
          id: 'row-a',
          label: 'A',
          cells: [
            { id: 'name-a', type: 'text', content: '시안 A' },
            { id: 'image-a', type: 'image', content: '', imageUrl: IMAGE_URL },
          ],
        },
      ],
    } as Question,
  ];
  return {
    id: 'image-enlarge-back',
    title: '크게 보기 뒤로 가기',
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
    createdAt: new Date('2026-10-21T00:00:00.000Z'),
    updatedAt: new Date('2026-10-21T00:00:00.000Z'),
  } as Survey;
}

async function renderOnSecondPage() {
  restoreMatchMedia = stubMatchMedia({ mobile: false, hover: true });
  render(
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier="preview-image-enlarge-back"
      previewContext={{ survey: buildSurvey(), versionId: 'version-1' }}
    />,
  );
  await screen.findByText('첫 페이지 질문');
  fireEvent.click(screen.getByRole('button', { name: /다음/ }));
  await screen.findByText('둘째 페이지 표');
}

async function openEnlarge() {
  const img = document.querySelector(`img[src="${IMAGE_URL}"]`) as HTMLImageElement;
  loadImageWithSize(img, {
    natural: { width: 1920, height: 1400 },
    rendered: { width: 132, height: 96 },
  });
  fireEvent.click(screen.getByRole('button', { name: '셀 이미지 크게 보기' }));
  await screen.findByRole('dialog', { name: '이미지 크게 보기' });
}

function pressBrowserBack() {
  act(() => window.history.back());
}

describe('이미지 크게 보기 — 뒤로 가기', () => {
  it('크게 보기를 연 채 뒤로 가기를 누르면 창만 닫히고 페이지는 그대로다', async () => {
    await renderOnSecondPage();
    await openEnlarge();

    pressBrowserBack();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('둘째 페이지 표')).toBeInTheDocument();
    expect(screen.queryByText('첫 페이지 질문')).toBeNull();
  });

  it('X 로 닫아도 페이지는 그대로다', async () => {
    await renderOnSecondPage();
    await openEnlarge();

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('둘째 페이지 표')).toBeInTheDocument();
  });

  it('크게 보기를 열고 닫은 뒤의 뒤로 가기는 이전 페이지로 간다(남은 칸이 없다)', async () => {
    await renderOnSecondPage();
    await openEnlarge();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    pressBrowserBack();

    expect(await screen.findByText('첫 페이지 질문')).toBeInTheDocument();
  });

  it('크게 보기를 연 적 없으면 뒤로 가기는 종전대로 이전 페이지로 간다', async () => {
    await renderOnSecondPage();

    pressBrowserBack();

    expect(await screen.findByText('첫 페이지 질문')).toBeInTheDocument();
  });
});
