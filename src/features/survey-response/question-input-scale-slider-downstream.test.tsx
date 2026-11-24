import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasDistinctQuestionViolation } from '@/features/question-renderer/utils/distinct-question-group';
import { QuestionInput } from '@/features/survey-response/question-input';
import type { Question } from '@/types/survey';
import { getBranchRuleForResponse, shouldDisplayQuestion } from '@/utils/branch-logic';

/**
 * 슬라이더로 답한 값이 뒤따르는 판정에서 그대로 동작하는가 — 분기 규칙 · 문항 사이의 중복 불가 묶음 ·
 * 그 문항을 따라오는 표시 조건(CONTEXT.md 「척도 슬라이더」: 모양만 바뀌고 값은 같다).
 * 같은 문항을 슬라이더로 그렸을 때와 보기 목록으로 그렸을 때, 화면이 쓴 값을 세 판정에 그대로 넣어 대조한다.
 */

afterEach(cleanup);

const recommend = (extra: Partial<Question> = {}): Question =>
  ({
    id: 'q-recommend',
    type: 'radio',
    title: '추천 의향',
    required: true,
    order: 0,
    distinctGroup: '의향',
    options: [
      {
        id: 'o1',
        label: '전혀 없다',
        value: '1',
        branchRule: { id: 'b1', value: '1', action: 'end', endOutcome: 'screened_out' },
      },
      { id: 'o2', label: '없다', value: '2' },
      { id: 'o3', label: '보통이다', value: '3' },
      { id: 'o4', label: '있다', value: '4' },
      { id: 'o5', label: '매우 있다', value: '5' },
    ],
    ...extra,
  }) as unknown as Question;

/** 같은 묶음의 다른 문항 — 이미 「4」를 골랐다 */
const reuse = {
  id: 'q-reuse',
  type: 'radio',
  title: '재이용 의향',
  required: true,
  order: 1,
  distinctGroup: '의향',
  options: [
    { id: 'p4', label: '있다', value: '4' },
    { id: 'p5', label: '매우 있다', value: '5' },
  ],
} as unknown as Question;

/** 추천 의향이 「있다」·「매우 있다」일 때만 보이는 문항 */
const reason = {
  id: 'q-reason',
  type: 'text',
  title: '추천하는 이유',
  required: false,
  order: 2,
  displayCondition: {
    logicType: 'AND',
    conditions: [
      {
        id: 'c1',
        sourceQuestionId: 'q-recommend',
        conditionType: 'value-match',
        requiredValues: ['4', '5'],
        logicType: 'AND',
      },
    ],
  },
} as unknown as Question;

/** 화면에서 그 보기를 골라 쓰인 값 — 슬라이더면 트랙의 그 눈금 자리를 누르고, 목록이면 보기 라벨을 누른다 */
function answerOnScreen(question: Question, optionIndex: number): unknown {
  const onChange = vi.fn();
  const view = render(<QuestionInput question={question} value={undefined} onChange={onChange} />);
  const track = screen.queryByTestId('scale-slider-track');
  if (track) {
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
    const clientX = 150 + optionIndex * 100;
    fireEvent.pointerDown(track, { pointerId: 1, button: 0, clientX });
    fireEvent.pointerUp(track, { pointerId: 1, button: 0, clientX });
  } else {
    const option = question.options![optionIndex]!;
    fireEvent.click(view.container.querySelector(`label[for="${question.id}-${option.id}"]`)!);
  }
  expect(onChange).toHaveBeenCalledTimes(1);
  const written = onChange.mock.calls[0]![0] as unknown;
  view.unmount();
  return written;
}

/** 쓰인 값으로 본 세 판정 */
function downstream(question: Question, written: unknown) {
  const all = [question, reuse, reason];
  const responses = { [question.id]: written, [reuse.id]: '4' };
  return {
    written,
    branchRule: getBranchRuleForResponse(question, written),
    distinctViolation: hasDistinctQuestionViolation(question, written, all, responses),
    reasonShown: shouldDisplayQuestion(reason, responses, all),
  };
}

describe('라디오 문항 슬라이더 — 답한 값으로 도는 판정', () => {
  it('「있다」: 같은 묶음의 문항과 겹쳐 막히고, 따라오는 문항이 보이고, 분기 규칙은 없다 — 보기 목록과 같다', () => {
    const asList = downstream(recommend(), answerOnScreen(recommend(), 3));
    const sliderQuestion = recommend({ scaleSlider: 'positive-right' });
    const asSlider = downstream(sliderQuestion, answerOnScreen(sliderQuestion, 3));

    expect(asSlider).toEqual(asList);
    expect(asSlider).toEqual({
      written: '4',
      branchRule: null,
      distinctViolation: true,
      reasonShown: true,
    });
  });

  it('「전혀 없다」: 그 보기의 분기 규칙이 잡히고, 겹치지 않고, 따라오는 문항이 숨는다 — 보기 목록과 같다', () => {
    const asList = downstream(recommend(), answerOnScreen(recommend(), 0));
    const sliderQuestion = recommend({ scaleSlider: 'positive-left' });
    const asSlider = downstream(sliderQuestion, answerOnScreen(sliderQuestion, 0));

    expect(asSlider).toEqual(asList);
    expect(asSlider.written).toBe('1');
    expect(asSlider.branchRule).toMatchObject({ action: 'end', endOutcome: 'screened_out' });
    expect(asSlider.distinctViolation).toBe(false);
    expect(asSlider.reasonShown).toBe(false);
  });
});
