import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
import { QuestionInput } from '@/features/survey-response/question-input';
import type { Question } from '@/types/survey';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});

/** 단일선택 명단 값 프리필 — 맞는 보기를 골라 두고 잠근다, 맞지 않으면 평범한 단일선택이다. */
describe('RadioQuestion 명단 값 프리필', () => {
  afterEach(cleanup);

  const question = {
    id: 'q-a1',
    type: 'radio',
    title: 'A1',
    required: true,
    order: 0,
    defaultValueTemplate: '{{지원사업}}',
    options: [
      { id: 'o1', label: '① 예술분야 초기창업 지원사업', value: '1' },
      { id: 'o2', label: '② 예술분야 창업도약 지원사업', value: '2' },
      { id: 'o3', label: '③ 예술분야 성장도약 지원사업', value: '3' },
    ],
  } as unknown as Question;

  const renderRadio = (
    attrs: Record<string, string>,
    value: unknown,
    onChange: (v: unknown) => void,
  ) =>
    render(
      <ContactAttrsProvider attrs={attrs}>
        <QuestionInput question={question} value={value} onChange={onChange} />
      </ContactAttrsProvider>,
    );

  it('명단 값의 보기를 마운트 때 한 번 고르고 모든 보기를 잠근다', () => {
    const onChange = vi.fn();
    const { container } = renderRadio({ 지원사업: '창업도약' }, undefined, onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2');
    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(3);
    expect(radios.every((r) => r.disabled)).toBe(true);
  });

  it('잠긴 문항은 다른 보기를 눌러도 바뀌지 않는다', () => {
    const onChange = vi.fn();
    const { container } = renderRadio({ 지원사업: '창업도약' }, '2', onChange);
    expect(onChange).not.toHaveBeenCalled();
    const label = container.querySelector('label[for="q-a1-o1"]')!;
    fireEvent.click(label);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('명단 값이 없으면 잠그지 않고 응답자가 고른 값을 둔다', () => {
    const onChange = vi.fn();
    const { container } = renderRadio({}, '3', onChange);
    expect(onChange).not.toHaveBeenCalled();
    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.some((r) => r.disabled)).toBe(false);
  });
});
