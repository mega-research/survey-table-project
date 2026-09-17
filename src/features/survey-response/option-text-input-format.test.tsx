import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OptionTextInput } from '@/features/question-renderer/option-text-input';
import { ResponseSourcesProvider } from '@/features/question-renderer/response-sources';
import { liveResponseSources } from '@/features/survey-response/stores/live-response-sources';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';

/** 응답 화면 배선 — 응답 스토어를 옵션 텍스트 원본으로 주입한다. */
function renderLive(ui: React.ReactElement) {
  return render(
    <ResponseSourcesProvider sources={liveResponseSources}>{ui}</ResponseSourcesProvider>,
  );
}

const stored = () => useSurveyResponseStore.getState().optionTexts['q1']?.['o1'] ?? '';

describe('OptionTextInput — 입력 형식', () => {
  beforeEach(() => useSurveyResponseStore.getState().resetResponseState());
  afterEach(() => cleanup());

  it('타이핑 중에는 숫자·하이픈만 받고(공백·글자는 떨어뜨림) blur 시 정돈한다', async () => {
    const user = userEvent.setup();
    renderLive(<OptionTextInput questionId="q1" option={{ id: 'o1', textInputType: 'mobile' }} />);
    const box = screen.getByRole('textbox');

    await user.type(box, '010 12a34-5678');
    expect(stored()).toBe('0101234-5678');

    await user.tab();
    expect(stored()).toBe('010-1234-5678');
    expect(box).toHaveValue('010-1234-5678');
  });

  it('형식이 틀리면 blur 후 사유 문구가 뜨고 값은 그대로다', async () => {
    const user = userEvent.setup();
    renderLive(<OptionTextInput questionId="q1" option={{ id: 'o1', textInputType: 'email' }} />);
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
    renderLive(<OptionTextInput questionId="q1" option={{ id: 'o1' }} />);
    await user.type(screen.getByRole('textbox'), '010 1234 5678');
    await user.tab();
    expect(stored()).toBe('010 1234 5678');
  });

  it('예시 값이 placeholder 로 보인다', () => {
    renderLive(<OptionTextInput questionId="q1" option={{ id: 'o1', textInputType: 'phone' }} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '02-123-4567');
  });
});
