import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuestionInput } from '@/components/survey-response/question-input';
import { PriorAnswersProvider } from '@/lib/survey/prior-answers-context';
import { selectHighlightablePriorAnswers } from '@/lib/survey/prior-answer-highlight';
import type { Question } from '@/types/survey';

// 선택형 렌더러가 useMobileView 를 탄다 — jsdom 에는 matchMedia 가 없다.
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'text',
    title: '문항',
    required: false,
    order: 0,
    ...overrides,
  } as Question;
}

function Harness({
  q,
  initialValue,
  prior,
}: {
  q: Question;
  initialValue?: unknown;
  prior: Record<string, unknown> | null;
}) {
  const [value, setValue] = useState<unknown>(initialValue);
  return (
    <PriorAnswersProvider
      answers={prior}
      confirmAnswers={null}
      highlightAnswers={selectHighlightablePriorAnswers(prior, [q])}
      waveLabel={null}
      changeConfirmEnabled={false}
    >
      <QuestionInput question={q} value={value} onChange={setValue} />
    </PriorAnswersProvider>
  );
}

const radio = question({
  type: 'radio',
  options: [
    { id: 'o1', label: '있음', value: '1' },
    { id: 'o2', label: '없음', value: '2' },
  ],
} as Partial<Question>);

describe('이월 표시 — 단답형', () => {
  it('이월 값과 같으면 값 텍스트가 빨강이다', () => {
    render(<Harness q={question()} initialValue="작년 답" prior={{ q1: '작년 답' }} />);
    expect(screen.getByRole('textbox').className).toContain('text-red-600');
  });

  it('한 글자만 고쳐도 빨강이 사라진다', async () => {
    render(<Harness q={question()} initialValue="작년 답" prior={{ q1: '작년 답' }} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, '!');
    expect(input.className).not.toContain('text-red-600');
  });

  it('이월 값이 없으면 칠하지 않는다', () => {
    render(<Harness q={question()} initialValue="내가 쓴 답" prior={null} />);
    expect(screen.getByRole('textbox').className).not.toContain('text-red-600');
  });

  it('본문 프리필 템플릿 문항은 대상이 아니다 — 템플릿 값이 이기는 칸이다', () => {
    const q = question({ defaultValueTemplate: '{{회사명}}' });
    render(<Harness q={q} initialValue="작년 답" prior={{ q1: '작년 답' }} />);
    expect(screen.getByRole('textbox').className).not.toContain('text-red-600');
  });
});

describe('이월 표시 — 라디오', () => {
  /**
   * `accent-*` 여야 한다. 이 레포에는 @tailwindcss/forms 가 없어서 네이티브 컨트롤에
   * 붙은 `text-*` 는 컨트롤 색을 바꾸지 못한다 — 그걸로 구현하면 판정은 맞는데 화면에는
   * 아무 변화가 없다.
   */
  it('이월 선택의 컨트롤에 accent 빨강이 붙는다', () => {
    render(<Harness q={radio} initialValue="1" prior={{ q1: '1' }} />);
    const [yes, no] = screen.getAllByRole('radio');
    expect(yes!.className).toContain('accent-red-500');
    expect(no!.className).not.toContain('accent-red-500');
  });

  it('다른 보기를 고르면 원래 색으로 돌아온다', async () => {
    render(<Harness q={radio} initialValue="1" prior={{ q1: '1' }} />);
    await userEvent.click(screen.getAllByRole('radio')[1]!);
    for (const el of screen.getAllByRole('radio')) {
      expect(el.className).not.toContain('accent-red-500');
    }
  });

  it('작년과 같은 보기를 다시 고르면 빨강으로 돌아온다 — 동일성 기준이라 출처를 묻지 않는다', async () => {
    render(<Harness q={radio} initialValue="2" prior={{ q1: '1' }} />);
    expect(screen.getAllByRole('radio')[0]!.className).not.toContain('accent-red-500');
    await userEvent.click(screen.getAllByRole('radio')[0]!);
    expect(screen.getAllByRole('radio')[0]!.className).toContain('accent-red-500');
  });
});

describe('이월 표시 — 체크박스', () => {
  const checkbox = question({
    type: 'checkbox',
    options: [
      { id: 'o1', label: 'A', value: 'a' },
      { id: 'o2', label: 'B', value: 'b' },
      { id: 'o3', label: 'C', value: 'c' },
    ],
  } as Partial<Question>);

  it('작년 체크와 새로 고른 체크가 한 문항 안에서 갈린다', async () => {
    render(<Harness q={checkbox} initialValue={['a']} prior={{ q1: ['a', 'c'] }} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[0]!.className).toContain('accent-red-500');
    await userEvent.click(boxes[1]!);
    expect(boxes[0]!.className).toContain('accent-red-500');
    expect(boxes[1]!.className).not.toContain('accent-red-500');
  });
});
