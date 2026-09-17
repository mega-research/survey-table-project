import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuestionInput } from '@/features/survey-response/question-input';
import type { Question } from '@/types/survey';

function q(type: 'text' | 'textarea', overrides: Partial<Question> = {}): Question {
  return { id: 'q1', type, title: '의견', required: false, order: 0, ...overrides } as Question;
}

/**
 * 단답형·장문형 입력칸 높이 — 줄 수·입력한 만큼 높이 늘리기 (0124).
 * 설정이 없는 문항은 기존 모양(단답형 한 줄, 장문형 4줄 고정)이어야 한다.
 */
describe('단답형 입력칸 높이', () => {
  it('설정이 없으면 한 줄 입력칸 그대로다', () => {
    render(<QuestionInput question={q('text')} value="" onChange={() => {}} />);
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });

  it('줄 수 2 이상이면 그 높이의 여러 줄 칸이고 값 저장 창구는 같다', () => {
    const onChange = vi.fn();
    render(<QuestionInput question={q('text', { inputRows: 3 })} value="" onChange={onChange} />);
    const box = screen.getByRole('textbox');
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('rows', '3');
  });

  it('높이 늘리기를 켜면 줄 수 1 이어도 여러 줄 칸이고 내용 높이를 따른다', () => {
    const scrollHeight = vi
      .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(88);
    render(
      <QuestionInput question={q('text', { inputAutoGrow: true })} value="긴 글" onChange={() => {}} />,
    );
    const box = screen.getByRole('textbox');
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('rows', '1');
    expect(box.style.height).toBe('88px');
    scrollHeight.mockRestore();
  });

  it('숫자·입력 형식 칸은 설정이 있어도 한 줄이다', () => {
    const { unmount } = render(
      <QuestionInput
        question={q('text', { inputType: 'number', inputRows: 5, inputAutoGrow: true })}
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
    unmount();
    render(
      <QuestionInput
        question={q('text', { inputType: 'email', inputRows: 5 })}
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });
});

describe('장문형 입력칸 높이', () => {
  it('설정이 없으면 기존 4줄 고정이다', () => {
    render(<QuestionInput question={q('textarea')} value="긴 글" onChange={() => {}} />);
    const box = screen.getByRole('textbox');
    expect(box).toHaveAttribute('rows', '4');
    expect(box.style.height).toBe('');
  });

  it('줄 수를 주면 그 높이다', () => {
    render(<QuestionInput question={q('textarea', { inputRows: 8 })} value="" onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '8');
  });

  it('높이 늘리기를 켜면 내용 높이를 따른다', () => {
    const scrollHeight = vi
      .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(240);
    render(
      <QuestionInput
        question={q('textarea', { inputAutoGrow: true })}
        value="긴 글"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('textbox').style.height).toBe('240px');
    scrollHeight.mockRestore();
  });
});
