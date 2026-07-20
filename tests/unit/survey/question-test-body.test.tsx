import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { QuestionTestBody } from '@/components/survey-builder/question-test-card';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { Question } from '@/types/survey';

/**
 * QuestionTestBody — 편집 페이지 질문 카드의 미리보기(실제 응답 렌더링) 본문.
 * 카드 껍데기 없이 입력 컨트롤을 그대로 렌더하고, 입력은 테스트 응답 스토어에
 * 쌓인다(설문 응답 저장 경로와 무관).
 */

const radioQuestion = {
  id: 'q1',
  type: 'radio',
  title: '단일선택',
  required: false,
  order: 0,
  options: [
    { id: 'o1', label: '① 예', value: '1' },
    { id: 'o2', label: '② 아니오', value: '2' },
  ],
} as unknown as Question;

describe('QuestionTestBody', () => {
  beforeEach(() => {
    useTestResponseStore.getState().clearTestResponses();
  });

  it('실제 응답 컨트롤을 렌더한다', () => {
    render(<QuestionTestBody question={radioQuestion} />);
    expect(screen.getByText('① 예')).toBeInTheDocument();
    expect(screen.getByText('② 아니오')).toBeInTheDocument();
  });

  it('입력이 테스트 응답 스토어에 기록된다', () => {
    render(<QuestionTestBody question={radioQuestion} />);
    fireEvent.click(screen.getByText('① 예'));
    expect(useTestResponseStore.getState().testResponses['q1']).toBeTruthy();
  });
});
