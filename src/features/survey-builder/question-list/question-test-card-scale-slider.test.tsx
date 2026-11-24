import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuestionTestBody } from '@/features/survey-builder/question-list/question-test-card';
import { useTestResponseStore } from '@/features/survey-builder/stores/test-response-store';
import { QuestionInput } from '@/features/survey-response/question-input';
import type { Question, QuestionOption } from '@/types/survey';

/**
 * 빌더 미리보기 카드의 라디오 문항 — 척도 슬라이더(문항 설정)를 켜면 응답 화면과 **같은 조각**으로 그린다
 * (question-renderer/radio-question-scale-slider). 두 곳이 보기 목록을 따로 그리는 구조라, 같은 문항을
 * 넣었을 때 같은 구조가 나오는지를 여기서 대조한다.
 */

const FIVE: QuestionOption[] = [
  { id: 'o1', label: '전혀 없다', value: '1' },
  { id: 'o2', label: '없다', value: '2' },
  { id: 'o3', label: '보통이다', value: '3' },
  { id: 'o4', label: '있다', value: '4' },
  { id: 'o5', label: '매우 있다', value: '5' },
];

const radio = (extra: Partial<Question> = {}): Question =>
  ({
    id: 'q7',
    type: 'radio',
    title: '추천 의향',
    required: false,
    order: 0,
    options: [...FIVE, { id: 'o9', label: '잘 모르겠다', value: '9', excludeFromMean: true }],
    ...extra,
  }) as unknown as Question;

const slider = (extra: Partial<Question> = {}) => radio({ scaleSlider: 'positive-left', ...extra });

const answer = () => useTestResponseStore.getState().testResponses['q7'];

function trackOf() {
  const track = screen.getByTestId('scale-slider-track');
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 600,
    width: 500,
    top: 0,
    bottom: 32,
    height: 32,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  return track;
}

const press = (track: HTMLElement, clientX: number) => {
  fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX });
  fireEvent.pointerUp(track, { pointerId: 1, button: 0, clientX });
};

describe('QuestionTestBody — 라디오 문항의 척도 슬라이더', () => {
  beforeEach(() => {
    useTestResponseStore.getState().clearTestResponses();
  });
  afterEach(cleanup);

  it('같은 문항을 넣으면 응답 화면과 같은 구조로 그려진다', () => {
    const question = slider();
    const response = render(<QuestionInput question={question} value="2" onChange={vi.fn()} />);
    const expected = screen.getByTestId('scale-slider-q7').outerHTML;
    response.unmount();

    useTestResponseStore.getState().updateTestResponse('q7', '2');
    render(<QuestionTestBody question={question} />);
    expect(screen.getByTestId('scale-slider-q7').outerHTML).toBe(expected);
  });

  it('트랙을 누르면 보기 value 가 테스트 응답에 쓰이고, 다시 누르면 비워진다', () => {
    render(<QuestionTestBody question={slider()} />);
    press(trackOf(), 450);
    expect(answer()).toBe('4');
    press(trackOf(), 450);
    expect(answer()).toBeNull();
  });

  it('척도 밖 체크를 누르면 그 보기의 value 가 쓰인다', () => {
    const { container } = render(<QuestionTestBody question={slider()} />);
    fireEvent.click(container.querySelector('input[id$="o9-slider"]')!);
    expect(answer()).toBe('9');
  });

  it('설정이 없는 문항과 빌더가 끈 문항(null)은 보기 목록 그대로다', () => {
    const off = render(<QuestionTestBody question={radio()} />);
    const expected = off.container.innerHTML;
    expect(off.container.querySelector('input[id="q7-o1"]')).not.toBeNull();
    off.unmount();

    const { container } = render(<QuestionTestBody question={radio({ scaleSlider: null })} />);
    expect(container.innerHTML).toBe(expected);
  });

  it('상세 기재 보기가 있으면 설정을 끈 문항과 똑같이 그려진다', () => {
    const options = [...FIVE, { id: 'o6', label: '기타', value: '6', allowTextInput: true }];
    const off = render(<QuestionTestBody question={radio({ options, optionsColumns: 3 })} />);
    const expected = off.container.innerHTML;
    off.unmount();

    const { container } = render(
      <QuestionTestBody question={slider({ options, optionsColumns: 3 })} />,
    );
    expect(container.innerHTML).toBe(expected);
  });

  it('옛 「기타」 보기가 있는 문항도 보기 목록 그대로다', () => {
    const options = [...FIVE, { id: 'other-option', label: '기타', value: 'other' }];
    render(<QuestionTestBody question={slider({ options })} />);
    expect(screen.queryByTestId('scale-slider-q7')).toBeNull();
    expect(screen.getByLabelText('기타')).toBeInTheDocument();
  });
});
