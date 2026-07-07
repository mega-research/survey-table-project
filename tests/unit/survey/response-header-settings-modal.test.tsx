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

async function openModal() {
  render(<ResponseHeaderSettingsModal />);
  await userEvent.click(screen.getByText('응답 페이지 머리말 설정'));
}

describe('ResponseHeaderSettingsModal', () => {
  beforeEach(() => {
    seedSurvey();
  });

  afterEach(() => {
    cleanup();
  });

  it('카드를 클릭하면 2-pane 다이얼로그가 열리고 데스크톱 미리보기가 기본이다', async () => {
    await openModal();
    expect(screen.getByTestId('header-preview-desktop')).toBeInTheDocument();
    expect(screen.queryByTestId('header-preview-mobile')).not.toBeInTheDocument();
  });

  it('모바일 토글을 누르면 390px 미리보기로 전환된다', async () => {
    await openModal();
    await userEvent.click(screen.getByRole('button', { name: '모바일' }));
    expect(screen.getByTestId('header-preview-mobile')).toBeInTheDocument();
  });

  it('편집이 store에 즉시 반영되지 않는다 — 미리보기에만 반영된다', async () => {
    await openModal();

    await userEvent.click(screen.getByRole('button', { name: '프리셋 국가통계형' }));

    // 초안(draft) 게이트 — 저장 전까지 store는 원상 유지
    expect(useSurveyBuilderStore.getState().currentSurvey.settings.responseHeader).toEqual(
      DEFAULT_RESPONSE_HEADER_CONFIG,
    );

    // 미리보기(초안)에는 즉시 반영 — 마크·로고 자리표시자가 밴드에 렌더된다
    expect(screen.getByTestId('header-band')).toBeInTheDocument();
    expect(screen.getAllByText('로고').length).toBeGreaterThan(0);
  });

  it('저장을 누르면 초안이 store에 반영되고 모달이 닫힌다', async () => {
    await openModal();

    await userEvent.click(screen.getByRole('button', { name: '프리셋 국가통계형' }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));

    const responseHeader = useSurveyBuilderStore.getState().currentSurvey.settings.responseHeader;
    expect(responseHeader?.style).toBe('composed');
    if (responseHeader?.style !== 'composed') throw new Error('composed 헤더가 아닙니다');
    expect(responseHeader.blocks?.map((b) => b.type)).toEqual(['mark', 'notice', 'logo', 'logo']);

    // 모달이 닫혔다 — 설정 컨트롤(프리셋 버튼)이 더 이상 존재하지 않는다
    expect(screen.queryByRole('button', { name: '프리셋 국가통계형' })).not.toBeInTheDocument();
  });

  it('취소를 누르면 초안이 폐기되고 재오픈 시 store 기준으로 재시드된다', async () => {
    await openModal();

    await userEvent.click(screen.getByRole('button', { name: '프리셋 국가통계형' }));
    await userEvent.click(screen.getByRole('button', { name: '취소' }));

    expect(useSurveyBuilderStore.getState().currentSurvey.settings.responseHeader).toEqual(
      DEFAULT_RESPONSE_HEADER_CONFIG,
    );

    // 재오픈 — 직전 초안(프리셋 적용분)이 아니라 store 원본 기준으로 재시드된다
    await userEvent.click(screen.getByText('응답 페이지 머리말 설정'));
    expect(screen.queryByText('로고')).not.toBeInTheDocument();
  });

  it('제목 입력은 저장 전까지 store에 반영되지 않고, 저장 시 반영된다', async () => {
    await openModal();

    await userEvent.type(screen.getByLabelText('제목'), '!');
    expect(useSurveyBuilderStore.getState().currentSurvey.title).toBe('내 설문');

    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(useSurveyBuilderStore.getState().currentSurvey.title).toBe('내 설문!');
  });
});
