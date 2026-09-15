import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TextValidation } from '@/types/survey';

import { TextValidationFields, summarizeTextValidation } from './text-validation-fields';

function Harness({ initial }: { initial: TextValidation | null }) {
  const [value, setValue] = useState<TextValidation | null>(initial);
  return (
    <>
      <TextValidationFields value={value} onChange={setValue} locked={false} idPrefix="t" />
      <output data-testid="stored">{JSON.stringify(value)}</output>
    </>
  );
}

describe('TextValidationFields — 접기/펼치기', () => {
  it('설정이 없으면 접힌 채 시작하고 머리줄에 「설정 없음」이 보인다', () => {
    render(<Harness initial={null} />);
    expect(screen.getByRole('button', { name: /응답 품질 검사/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByTestId('t-text-validation-summary')).toHaveTextContent('설정 없음');
    expect(screen.queryByLabelText('최소 글자 수')).toBeNull();
  });

  it('설정이 하나라도 있으면 펼친 채 시작한다', () => {
    render(<Harness initial={{ minLength: 10, rejectMeaningless: true }} />);
    expect(screen.getByRole('button', { name: /응답 품질 검사/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByLabelText('최소 글자 수')).toHaveValue(10);
  });

  it('머리줄을 누르면 접히고 펼쳐지며, 접힌 뒤에도 요약이 남는다', () => {
    render(<Harness initial={{ maxLength: 200 }} />);
    const head = screen.getByRole('button', { name: /응답 품질 검사/ });
    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('t-text-validation-summary')).toHaveTextContent('최대 200자');
    fireEvent.click(head);
    expect(screen.getByLabelText('최대 글자 수')).toHaveValue(200);
  });

  it('값을 비우면 null 로 알린다 — 패치에서 undefined 는 손대지 않음이다', () => {
    render(<Harness initial={{ minLength: 10 }} />);
    fireEvent.change(screen.getByLabelText('최소 글자 수'), { target: { value: '' } });
    expect(screen.getByTestId('stored')).toHaveTextContent('null');
  });

  it('잠금이면 입력이 비활성이고 머리줄이 「평문 모드 전용」을 보인다', () => {
    render(<TextValidationFields value={null} onChange={vi.fn()} locked idPrefix="c" />);
    expect(screen.getByTestId('c-text-validation-summary')).toHaveTextContent('평문 모드 전용');
    fireEvent.click(screen.getByRole('button', { name: /응답 품질 검사/ }));
    expect(screen.getByLabelText('최소 글자 수')).toBeDisabled();
  });
});

describe('summarizeTextValidation', () => {
  it('켜진 항목만 이어 붙인다', () => {
    expect(summarizeTextValidation({ minLength: 5, maxLength: 50, rejectMeaningless: true })).toBe(
      '최소 5자 · 최대 50자 · 무의미 입력 막기',
    );
    expect(summarizeTextValidation({})).toBe('설정 없음');
    expect(summarizeTextValidation(null)).toBe('설정 없음');
  });
});
