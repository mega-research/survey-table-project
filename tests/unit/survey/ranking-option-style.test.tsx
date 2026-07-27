import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RankingDropdownStack } from '@/components/survey-response/ranking-dropdown-stack';
import type { QuestionOption } from '@/types/survey';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => false,
  useMediaQuery: () => false,
}));

const options: QuestionOption[] = [
  {
    id: 'styled',
    value: 'styled',
    label: '강조 옵션',
    textBold: true,
    backgroundColor: '#AABBCC',
  },
  { id: 'plain', value: 'plain', label: '일반 옵션' },
];

describe('RankingDropdownStack 옵션 스타일', () => {
  it('Radix 옵션 목록과 선택된 트리거에 옵션 스타일을 표시한다', () => {
    const { rerender } = render(
      <RankingDropdownStack
        answers={[]}
        options={options}
        positions={1}
        allowDuplicates={false}
        allowOther={false}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: '1순위 선택' });
    fireEvent.click(trigger);

    const styledItem = screen.getByRole('option', { name: '강조 옵션' });
    expect(styledItem).toHaveClass('font-bold');
    expect(styledItem).toHaveClass(
      'data-[highlighted]:ring-2',
      'data-[highlighted]:ring-blue-500',
      'data-[highlighted]:ring-inset',
    );
    expect(styledItem).toHaveStyle({
      backgroundColor: '#AABBCC',
    });
    expect(screen.getByRole('option', { name: '일반 옵션' })).not.toHaveClass('font-bold');
    expect(screen.getByRole('option', { name: '일반 옵션' })).not.toHaveStyle({
      backgroundColor: '#AABBCC',
    });

    fireEvent.keyDown(trigger, { key: 'Escape' });

    rerender(
      <RankingDropdownStack
        answers={[{ rank: 1, optionValue: 'styled' }]}
        options={options}
        positions={1}
        allowDuplicates={false}
        allowOther={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: '1순위 선택' })).toHaveClass('font-bold');
    expect(screen.getByRole('combobox', { name: '1순위 선택' })).toHaveStyle({
      backgroundColor: '#AABBCC',
    });
  });

  it('compact 네이티브 옵션에도 가능한 범위에서 옵션 스타일을 전달한다', () => {
    render(
      <RankingDropdownStack
        answers={[]}
        options={options}
        positions={1}
        allowDuplicates={false}
        allowOther={false}
        onChange={vi.fn()}
        compact
      />,
    );

    const styledOption = screen.getByRole('option', { name: '강조 옵션' });
    expect(styledOption).toHaveClass('font-bold');
    expect(styledOption).toHaveStyle({ backgroundColor: '#AABBCC' });
  });
});
