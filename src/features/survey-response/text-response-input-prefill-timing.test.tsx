import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { QuestionInput } from '@/features/survey-response/question-input';
import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
import type { Question } from '@/types/survey';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});

/**
 * 단답형(TextResponseInput) prefill / emptyDefault 쓰기 횟수 박제 — 표 셀(input-cell) 과 대칭.
 * onChange 는 상위(handleResponse)가 바뀌면 새 identity 가 되지만 그것이 추가 쓰기를 만들면 안 된다.
 */
describe('TextResponseInput prefill·emptyDefault 쓰기 횟수', () => {
  afterEach(cleanup);

  const renderText = (question: Question, value: unknown, onChange: (v: unknown) => void) => (
    <ContactAttrsProvider attrs={{ 회사: '메가리서치' }}>
      <QuestionInput question={question} value={value} onChange={onChange} />
    </ContactAttrsProvider>
  );

  it('prefill 은 마운트 시 1회, 새 onChange identity 재렌더에는 0회', () => {
    const question = {
      id: 'q-text',
      type: 'text',
      title: '회사',
      required: false,
      order: 0,
      defaultValueTemplate: '{{회사}}',
    } as unknown as Question;
    const first = vi.fn();
    const { rerender } = render(renderText(question, undefined, first));
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith('메가리서치');

    const second = vi.fn();
    rerender(renderText(question, undefined, second));
    expect(second).not.toHaveBeenCalled();
  });

  it('emptyDefault 는 값 미존재일 때 1회, 빈 문자열로 지운 뒤 0회', () => {
    const question = {
      id: 'q-num',
      type: 'text',
      title: '숫자',
      required: false,
      order: 0,
      inputType: 'number',
      emptyDefault: 0,
    } as unknown as Question;
    const onChange = vi.fn();
    const { rerender } = render(renderText(question, undefined, onChange));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('0');

    const next = vi.fn();
    rerender(renderText(question, '', next));
    expect(next).not.toHaveBeenCalled();
  });
});
