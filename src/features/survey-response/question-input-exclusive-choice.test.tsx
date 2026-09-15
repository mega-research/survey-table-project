import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuestionInput } from '@/features/survey-response/question-input';
import type { Question } from '@/types/survey';

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

const checkbox = {
  id: 'q1',
  type: 'checkbox',
  title: '보유 제품',
  required: false,
  order: 0,
  options: [
    { id: 'o1', label: 'TV', value: '1' },
    { id: 'o2', label: '냉장고', value: '2' },
    { id: 'o3', label: '없음', value: '9', exclusiveChoice: true },
  ],
} as Question;

function Harness({ q }: { q: Question }) {
  const [value, setValue] = useState<unknown>(undefined);
  return (
    <>
      <QuestionInput question={q} value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value ?? null)}</output>
    </>
  );
}

const readValue = () => JSON.parse(screen.getByTestId('value').textContent ?? 'null');

describe('일반 체크박스 문항 — 단독 선택 보기', () => {
  it('「없음」을 고르면 나머지가 풀리고, 일반 보기를 고르면 「없음」이 풀린다', async () => {
    const user = userEvent.setup();
    render(<Harness q={checkbox} />);

    await user.click(screen.getByRole('checkbox', { name: 'TV' }));
    await user.click(screen.getByRole('checkbox', { name: '냉장고' }));
    await user.click(screen.getByRole('checkbox', { name: '없음' }));
    expect(readValue()).toEqual(['9']);
    expect(screen.getByRole('checkbox', { name: 'TV' })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'TV' }));
    expect(readValue()).toEqual(['1']);
    expect(screen.getByRole('checkbox', { name: '없음' })).not.toBeChecked();
  });

  it('최소 선택 수가 있어도 「없음」 하나면 미달 안내가 뜨지 않는다', async () => {
    const user = userEvent.setup();
    render(<Harness q={{ ...checkbox, minSelections: 2 } as Question} />);
    await user.click(screen.getByRole('checkbox', { name: 'TV' }));
    expect(screen.getByText(/최소 2개 이상/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: '없음' }));
    expect(screen.queryByText(/최소 2개 이상/)).not.toBeInTheDocument();
  });

  it('최대 선택 수에 꽉 찬 상태에서도 「없음」은 들어가고 나머지를 비운다', async () => {
    const user = userEvent.setup();
    render(<Harness q={{ ...checkbox, maxSelections: 2 } as Question} />);
    await user.click(screen.getByRole('checkbox', { name: 'TV' }));
    await user.click(screen.getByRole('checkbox', { name: '냉장고' }));
    await user.click(screen.getByRole('checkbox', { name: '없음' }));
    expect(readValue()).toEqual(['9']);
  });

  it('최대 1개일 때 「없음」이 골라져 있어도 일반 보기를 누르면 「없음」이 풀리고 그것이 들어간다', async () => {
    const user = userEvent.setup();
    render(<Harness q={{ ...checkbox, maxSelections: 1 } as Question} />);
    await user.click(screen.getByRole('checkbox', { name: '없음' }));
    expect(readValue()).toEqual(['9']);
    expect(screen.getByRole('checkbox', { name: 'TV' })).not.toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'TV' }));
    expect(readValue()).toEqual(['1']);
    expect(screen.getByRole('checkbox', { name: '냉장고' })).toBeDisabled();
  });
});
