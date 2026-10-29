/**
 * 추적조사 변동 확인 — 다국어 설문의 현재 언어로 확인 컨트롤과 제출 전 되묻기 창을 그린다.
 * 설문 설정의 회차 라벨은 저작자 글자라 그대로이고, 비웠을 때의 기본 라벨만 현재 언어다.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SurveyLocaleProvider } from '@/features/question-renderer/survey-locale-context';
import { DEFAULT_PRIOR_WAVE_LABEL } from '@/lib/survey/prior-answers';

import { ChangeConfirmControl } from './change-confirm-control';
import { UnmodifiedChangedDialog } from './unmodified-changed-dialog';

afterEach(cleanup);

describe('변동 확인 현재 언어', () => {
  it('中文 — 기본 회차 라벨과 선택지·필수 안내가 중국어다', () => {
    render(
      <SurveyLocaleProvider locale="zh">
        <ChangeConfirmControl
          questionId="q1"
          waveLabel={DEFAULT_PRIOR_WAVE_LABEL}
          value={null}
          onSelect={vi.fn()}
          showRequiredMessage
        />
      </SurveyLocaleProvider>,
    );
    expect(screen.getByText('已填入上一轮的回答')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '与上一轮相同' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '有变化' })).toBeInTheDocument();
    expect(screen.getByText('请选择此题的回答是否有变化')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/[가-힣]/);
  });

  it('English — 저작자가 적은 회차 라벨은 그대로 쓴다', () => {
    render(
      <SurveyLocaleProvider locale="en">
        <ChangeConfirmControl
          questionId="q1"
          waveLabel="2025 survey"
          value={null}
          onSelect={vi.fn()}
          showRequiredMessage={false}
        />
      </SurveyLocaleProvider>,
    );
    expect(screen.getByRole('radio', { name: 'Same as 2025 survey' })).toBeInTheDocument();
  });

  it('English — 제출 전 되묻기 창의 제목·본문·버튼이 영어다', () => {
    render(
      <UnmodifiedChangedDialog
        open
        questionTitles={['Q1']}
        waveLabel={DEFAULT_PRIOR_WAVE_LABEL}
        locale="en"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Some answers were not changed')).toBeInTheDocument();
    expect(
      screen.getByText(
        'You said the answers below changed, but they are the same as your answers from the previous wave. You can still submit as is.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go back and check' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit as is' })).toBeInTheDocument();
  });
});
