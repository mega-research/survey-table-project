import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SurveyCompletedScreen } from './survey-response-screens';

describe('SurveyCompletedScreen 「새 응답 시작」', () => {
  it('onStartNew 가 없으면 버튼을 그리지 않는다 (중복 응답 허용이 꺼진 설문)', () => {
    render(<SurveyCompletedScreen thankYouMessage="감사합니다" />);
    expect(screen.queryByRole('button', { name: '새 응답 시작' })).toBeNull();
  });

  it('onStartNew 가 있으면 버튼을 그리고 누르면 부른다', () => {
    const onStartNew = vi.fn();
    render(<SurveyCompletedScreen thankYouMessage="감사합니다" onStartNew={onStartNew} />);
    fireEvent.click(screen.getByRole('button', { name: '새 응답 시작' }));
    expect(onStartNew).toHaveBeenCalledTimes(1);
  });

  it('현재 언어로 버튼 글자를 낸다', () => {
    render(
      <SurveyCompletedScreen thankYouMessage={null} locale="en" onStartNew={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: 'Start a new response' })).toBeTruthy();
  });
});
