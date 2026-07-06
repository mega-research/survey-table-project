import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// CellImageEditor 는 업로드 의존성을 끌고 오므로 stub (로고형 선택 시 렌더됨)
vi.mock('@/components/survey-builder/cell-image-editor', () => ({
  CellImageEditor: () => null,
}));

import { ResponseHeaderSettingsModal } from '@/components/survey-builder/response-header-settings-modal';
import { DEFAULT_RESPONSE_HEADER_CONFIG } from '@/lib/survey/response-header-config';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { Survey } from '@/types/survey';

function seedSurvey() {
  const survey: Survey = {
    id: 's1',
    title: '내 설문',
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
      responseHeader: DEFAULT_RESPONSE_HEADER_CONFIG,
    },
    createdAt: new Date('2026-06-29T00:00:00.000Z'),
    updatedAt: new Date('2026-06-29T00:00:00.000Z'),
  };
  useSurveyBuilderStore.getState().setSurvey(survey);
}

describe('ResponseHeaderSettingsModal', () => {
  beforeEach(() => {
    seedSurvey();
  });

  afterEach(() => {
    cleanup();
  });

  it('카드 클릭 시 미리보기와 설정이 함께 있는 모달이 열린다', async () => {
    render(<ResponseHeaderSettingsModal />);

    // 닫힌 상태: 설정 컨트롤은 보이지 않는다
    expect(screen.queryByRole('button', { name: '제목 옆 로고형' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('응답 페이지 머리말 설정'));

    // 미리보기(설문 제목) + 설정 컨트롤이 함께 렌더된다
    expect(screen.getByRole('heading', { name: '내 설문' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '기본형' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '제목 옆 로고형' })).toBeInTheDocument();
  });

  it('프리셋 변경 시 store 가 갱신되고 미리보기가 반영된다', async () => {
    render(<ResponseHeaderSettingsModal />);
    await userEvent.click(screen.getByText('응답 페이지 머리말 설정'));

    await userEvent.click(screen.getByRole('button', { name: '제목 옆 로고형' }));

    expect(
      useSurveyBuilderStore.getState().currentSurvey.settings.responseHeader?.style,
    ).toBe('logo-title');
    // v1 logo-title 설정은 composed 로 마이그레이션되어 제목 밴드로 렌더된다 (모달 미리보기 개편은 Task 7)
    expect(screen.getByTestId('header-band')).toBeInTheDocument();
  });
});
