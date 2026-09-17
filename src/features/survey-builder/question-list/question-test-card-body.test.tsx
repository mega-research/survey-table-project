import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { QuestionTestBody } from '@/features/survey-builder/question-list/question-test-card';
import { useTestResponseStore } from '@/features/survey-builder/stores/test-response-store';
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

describe('QuestionTestBody — 체크박스 단독 선택 보기', () => {
  const checkboxQuestion = {
    id: 'q2',
    type: 'checkbox',
    title: '보유 제품',
    required: false,
    order: 0,
    maxSelections: 2,
    options: [
      { id: 'o1', label: 'TV', value: '1' },
      { id: 'o2', label: '냉장고', value: '2' },
      { id: 'o9', label: '없음', value: '9', exclusiveChoice: true },
    ],
  } as unknown as Question;

  beforeEach(() => {
    useTestResponseStore.getState().clearTestResponses();
  });

  it('빌더 테스트 모드도 같은 규칙 — 꽉 찬 상태에서 「없음」을 고르면 그것만 남고, 다시 일반 보기를 고르면 「없음」이 풀린다', () => {
    render(<QuestionTestBody question={checkboxQuestion} />);
    fireEvent.click(screen.getByLabelText('TV'));
    fireEvent.click(screen.getByLabelText('냉장고'));
    fireEvent.click(screen.getByLabelText('없음'));
    expect(useTestResponseStore.getState().testResponses['q2']).toEqual(['9']);

    fireEvent.click(screen.getByLabelText('TV'));
    expect(useTestResponseStore.getState().testResponses['q2']).toEqual(['1']);
  });

  it('최대 1개일 때 「없음」이 골라져 있어도 일반 보기를 누르면 「없음」이 풀린다', () => {
    render(
      <QuestionTestBody question={{ ...checkboxQuestion, maxSelections: 1 } as unknown as Question} />,
    );
    fireEvent.click(screen.getByLabelText('없음'));
    expect(useTestResponseStore.getState().testResponses['q2']).toEqual(['9']);
    expect(screen.getByLabelText('TV')).not.toBeDisabled();

    fireEvent.click(screen.getByLabelText('TV'));
    expect(useTestResponseStore.getState().testResponses['q2']).toEqual(['1']);
    expect(screen.getByLabelText('냉장고')).toBeDisabled();
  });
});
