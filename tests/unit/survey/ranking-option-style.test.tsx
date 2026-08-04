import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RankingDropdownStack } from '@/components/survey-response/ranking-dropdown-stack';
import type { QuestionOption } from '@/types/survey';
import { resolveRankingOptionsFromCells } from '@/utils/ranking-source';

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
    // 커스텀 배경색은 인라인 스타일이라 하이라이트 배경을 덮는다. 링이 있어야 어느 항목에
    // 커서가 있는지 보인다 — 색은 취향에 따라 바뀔 수 있으나 링 자체는 사라지면 안 된다.
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

  it('테이블 소스 상세기입 옵션을 선택하면 셀의 placeholder로 입력란을 렌더한다', () => {
    const [detailOption] = resolveRankingOptionsFromCells([
      {
        id: 'table-detail',
        type: 'ranking_opt',
        content: '기타 사유',
        allowTextInput: true,
        textInputPlaceholder: '사유를 입력하세요',
      },
    ]);
    if (!detailOption) throw new Error('테이블 소스 옵션 파생 실패');

    render(
      <RankingDropdownStack
        answers={[{ rank: 1, optionValue: 'table-detail' }]}
        options={[detailOption]}
        positions={1}
        allowDuplicates={false}
        allowOther={false}
        onChange={vi.fn()}
        detailTargetScopeId="question-1"
      />,
    );

    expect(screen.getByPlaceholderText('사유를 입력하세요')).toHaveAttribute(
      'data-option-text-target-id',
      'question-1:ranking:1:table-detail',
    );
  });

  it('기타 직접 입력도 순수 검증과 같은 안정 타깃 ID를 렌더한다', () => {
    render(
      <RankingDropdownStack
        answers={[{ rank: 1, optionValue: '__other__', otherText: ' ' }]}
        options={options}
        positions={1}
        allowDuplicates={false}
        allowOther
        onChange={vi.fn()}
        detailTargetScopeId="question-1"
      />,
    );

    expect(screen.getByPlaceholderText('기타 내용 입력...')).toHaveAttribute(
      'data-option-text-target-id',
      'question-1:ranking:1:__other__',
    );
  });
});
