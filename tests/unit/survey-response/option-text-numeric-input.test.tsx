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
