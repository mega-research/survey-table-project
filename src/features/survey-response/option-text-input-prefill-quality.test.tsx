import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
import { OptionTextInput } from '@/features/question-renderer/option-text-input';
import { ResponseSourcesProvider } from '@/features/question-renderer/response-sources';
import { liveResponseSources } from '@/features/survey-response/stores/live-response-sources';
import { useSurveyResponseStore } from '@/features/survey-response/stores/survey-response-store';

/**
 * 보기 문항 내장 표의 input 셀(사이드카 입력칸)은 prefill 을 깔지도 잠그지도 않는다. 그런데
 * 품질 검사의 잠금 면제는 셀의 템플릿으로 판정하므로, 차단 검증(numeric-validation)과 같은
 * 재료를 봐야 한다 — 「응답자가 고칠 수 있게」를 켠 칸은 검증이 면제하지 않으니 화면도 문구를
 * 보여야 한다(아니면 문구 없이 「다음」만 막힌다).
 */
function renderLive(ui: React.ReactElement) {
  return render(
    <ContactAttrsProvider attrs={{ 회사: '메가리서치' }}>
      <ResponseSourcesProvider sources={liveResponseSources}>{ui}</ResponseSourcesProvider>
    </ContactAttrsProvider>,
  );
}

describe('OptionTextInput — prefill 템플릿이 걸린 칸의 응답 품질 문구', () => {
  beforeEach(() => useSurveyResponseStore.getState().resetResponseState());
  afterEach(() => cleanup());

  const base = {
    id: 'o1',
    defaultValueTemplate: '{{회사}}',
    textValidation: { minLength: 5 },
  };

  it('「응답자가 고칠 수 있게」를 켠 칸은 면제하지 않고 문구를 보인다', async () => {
    const user = userEvent.setup();
    renderLive(<OptionTextInput questionId="q1" option={{ ...base, prefillEditable: true }} />);

    await user.type(screen.getByRole('textbox'), '짧다');
    await user.tab();

    expect(screen.getByTestId('cell-text-quality-violation')).toHaveTextContent(
      '5자 이상 입력해 주세요.',
    );
  });

  it('켜지 않은 칸은 종전대로 면제한다', async () => {
    const user = userEvent.setup();
    renderLive(<OptionTextInput questionId="q1" option={base} />);

    await user.type(screen.getByRole('textbox'), '짧다');
    await user.tab();

    expect(screen.queryByTestId('cell-text-quality-violation')).toBeNull();
  });
});
