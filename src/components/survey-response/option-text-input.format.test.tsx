import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OptionTextInput } from '@/components/survey-response/option-text-input';
import { useSurveyResponseStore } from '@/stores/survey-response-store';

const stored = () => useSurveyResponseStore.getState().optionTexts['q1']?.['o1'] ?? '';

describe('OptionTextInput — 입력 형식', () => {
  beforeEach(() => useSurveyResponseStore.getState().resetResponseState());
  afterEach(() => cleanup());

  it('타이핑 중에는 건드리지 않고 blur 시 정돈한다', async () => {
    const user = userEvent.setup();
    render(<OptionTextInput questionId="q1" option={{ id: 'o1', textInputType: 'mobile' }} />);
    const box = screen.getByRole('textbox');

    await user.type(box, '010 1234 5678');
    expect(stored()).toBe('010 1234 5678');

    await user.tab();
    expect(stored()).toBe('010-1234-5678');
    expect(box).toHaveValue('010-1234-5678');
  });

  it('형식이 틀리면 blur 후 사유 문구가 뜨고 값은 그대로다', async () => {
    const user = userEvent.setup();
    render(<OptionTextInput questionId="q1" option={{ id: 'o1', textInputType: 'email' }} />);
    const box = screen.getByRole('textbox');

    await user.type(box, 'nobody@nowhere');
    expect(screen.queryByText(/이메일 형식이 아닙니다/)).not.toBeInTheDocument();

    await user.tab();
    expect(screen.getByText(/이메일 형식이 아닙니다/)).toBeInTheDocument();
    expect(stored()).toBe('nobody@nowhere');
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });

  it('형식 미지정 칸은 종전대로 자유 텍스트', async () => {
    const user = userEvent.setup();
    render(<OptionTextInput questionId="q1" option={{ id: 'o1' }} />);
    await user.type(screen.getByRole('textbox'), '010 1234 5678');
    await user.tab();
    expect(stored()).toBe('010 1234 5678');
  });

  it('예시 값이 placeholder 로 보인다', () => {
    render(<OptionTextInput questionId="q1" option={{ id: 'o1', textInputType: 'phone' }} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '02-123-4567');
  });
});
