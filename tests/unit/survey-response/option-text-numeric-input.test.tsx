import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OptionTextInput } from '@/components/survey-response/option-text-input';
import { useSurveyResponseStore } from '@/stores/survey-response-store';

/**
 * "선택 시 텍스트 입력 받기" 의 숫자 모드 — 입력 셀과 같은 규칙(숫자만·콤마 표시·max 타이핑
 * 차단)을 옵션 사이드카 입력칸에서도 적용한다 (2026-09-02 요청).
 */
describe('OptionTextInput — 숫자 모드', () => {
  beforeEach(() => useSurveyResponseStore.getState().resetResponseState());
  afterEach(() => cleanup());

  const numericOption = {
    id: 'o1',
    textInputType: 'number' as const,
    textInputNumberFormat: { thousandSeparator: true, max: 5000 },
  };

  it('숫자가 아닌 입력은 무시된다', async () => {
    const user = userEvent.setup();
    render(<OptionTextInput questionId="q1" option={numericOption} />);
    await user.type(screen.getByRole('textbox'), 'abc');
    expect(useSurveyResponseStore.getState().optionTexts['q1']?.['o1'] ?? '').toBe('');
  });

  it('저장값은 숫자 그대로, 표시값은 천단위 콤마', async () => {
    const user = userEvent.setup();
    render(<OptionTextInput questionId="q1" option={numericOption} />);
    const box = screen.getByRole('textbox');
    await user.type(box, '1234');
    expect(useSurveyResponseStore.getState().optionTexts['q1']?.['o1']).toBe('1234');
    expect((box as HTMLInputElement).value).toBe('1,234');
  });

  it('max 를 넘는 타이핑은 차단된다', async () => {
    const user = userEvent.setup();
    render(<OptionTextInput questionId="q1" option={numericOption} />);
    await user.type(screen.getByRole('textbox'), '12345');
    expect(useSurveyResponseStore.getState().optionTexts['q1']?.['o1']).toBe('1234');
  });

  it('숫자 모드가 아니면 종전대로 자유 텍스트', async () => {
    const user = userEvent.setup();
    render(<OptionTextInput questionId="q1" option={{ id: 'o2' }} />);
    await user.type(screen.getByRole('textbox'), '자유 기재 12');
    expect(useSurveyResponseStore.getState().optionTexts['q1']?.['o2']).toBe('자유 기재 12');
  });
});

/**
 * 환산 읽기·범위 위반은 입력칸 **아래 한 줄**로 보인다.
 * 여태 title 툴팁으로만 알려 왔는데, 단답형 문항(question-input)·표의 입력 셀(input-cell)은
 * 둘 다 아래에 띄운다. 매출액처럼 자릿수 착오가 치명적인 칸에서 툴팁은 약하다.
 */
describe('OptionTextInput — 환산 읽기 표시', () => {
  beforeEach(() => useSurveyResponseStore.getState().resetResponseState());
  afterEach(() => cleanup());

  const wonOption = {
    id: 'o1',
    textInputType: 'number' as const,
    textInputNumberFormat: { thousandSeparator: true, unit: 'million' as const, unitSuffix: '원' },
  };

  it('값을 넣으면 단위 환산이 아래 줄에 뜬다', async () => {
    const user = userEvent.setup();
    render(<OptionTextInput questionId="q1" option={wonOption} />);
    await user.type(screen.getByRole('textbox'), '11111');
    expect(screen.getByText('1백 11억 1천 1백만원')).toBeInTheDocument();
  });

  it('값이 비면 아무 줄도 만들지 않는다', () => {
    render(<OptionTextInput questionId="q1" option={wonOption} />);
    expect(screen.queryByText(/억/)).not.toBeInTheDocument();
  });

  it('범위 위반은 포커스를 뗀 뒤 별도 줄로 보인다', async () => {
    const user = userEvent.setup();
    render(
      <OptionTextInput
        questionId="q1"
        option={{ id: 'o1', textInputType: 'number', textInputNumberFormat: { min: 100 } }}
      />,
    );
    await user.type(screen.getByRole('textbox'), '3');
    // 타이핑 중에는 숨긴다 — 100 을 치려면 1 을 먼저 지나가는데 그때마다 빨간 줄이 뜨면
    // 응답자가 자기가 뭘 잘못했다고 읽는다 (use-formatted-numeric-input 의 기존 규칙).
    expect(screen.queryByText(/100/)).not.toBeInTheDocument();

    await user.tab();
    expect(screen.getByText(/100/)).toBeInTheDocument();
  });

  it('숫자 모드가 아니면 아래 줄이 없다', async () => {
    const user = userEvent.setup();
    render(<OptionTextInput questionId="q1" option={{ id: 'o1' }} />);
    await user.type(screen.getByRole('textbox'), '11111');
    expect(screen.queryByText(/억/)).not.toBeInTheDocument();
  });
});

/**
 * 스택(칩 셸) 모드에서는 안내가 셸 **밖**에 놓인다.
 * 셸 안에 끼워 넣으면 좁은 입력칸을 나눠 쓰느라 글자를 줄일 수밖에 없어 읽히지 않는다.
 */
describe('OptionTextInput — 칩 셸 모드', () => {
  beforeEach(() => useSurveyResponseStore.getState().resetResponseState());
  afterEach(() => cleanup());

  const wonOption = {
    id: 'o1',
    textInputType: 'number' as const,
    textInputNumberFormat: { thousandSeparator: true, unit: 'million' as const, unitSuffix: '원' },
  };

  it('안내가 셸(label) 바깥에 렌더된다', async () => {
    const user = userEvent.setup();
    render(<OptionTextInput questionId="q1" option={wonOption} rowLabel="① 매출액" />);
    await user.type(screen.getByRole('textbox'), '20');

    const reading = screen.getByText('2천만원');
    expect(reading.closest('label')).toBeNull();
    // 입력칸은 셸 안에 남는다
    expect(screen.getByRole('textbox').closest('label')).not.toBeNull();
  });

  it('칩 문구가 셸 안에 나온다', () => {
    render(<OptionTextInput questionId="q1" option={wonOption} rowLabel="① 매출액" />);
    expect(screen.getByText('① 매출액').closest('label')).not.toBeNull();
  });
});
