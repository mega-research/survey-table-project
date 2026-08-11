import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RankingDropdownStack } from '@/components/survey-response/ranking-dropdown-stack';
import type { QuestionOption } from '@/types/survey';

// 모바일 가로 배치(columns=0)에서 트리거는 전체 폭으로 커지는데 상세 입력만 데스크톱용
// 고정 200px 를 유지해, 선택 상자보다 짧고 왼쪽 끝도 어긋나 보였다(2026-08-04).
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));

const options: QuestionOption[] = [
  { id: 'detail', value: 'detail', label: '⑦ 기타', allowTextInput: true },
  { id: 'plain', value: 'plain', label: '① 일반' },
];

function renderMobile(optionValue: string, allowOther = false) {
  return render(
    <RankingDropdownStack
      answers={[{ rank: 1, optionValue }]}
      options={options}
      positions={2}
      allowDuplicates={false}
      allowOther={allowOther}
      onChange={vi.fn()}
      columns={0}
      detailTargetScopeId="q1"
    />,
  );
}

describe('모바일 순위형 상세 입력 정렬', () => {
  it('상세 기재 입력은 고정 폭을 쓰지 않는다', () => {
    renderMobile('detail');
    const input = screen.getByPlaceholderText('상세 기재');
    // 데스크톱 가로 배치용 고정 폭(200px)이 모바일까지 새면 선택 상자보다 짧아진다.
    expect(input.style.width).toBe('');
  });

  it('상세 기재 입력은 전체 폭을 차지한다', () => {
    renderMobile('detail');
    expect(screen.getByPlaceholderText('상세 기재')).toHaveClass('w-full');
  });

  it('기타 직접 입력도 같은 규칙을 따른다', () => {
    renderMobile('__other__', true);
    const input = screen.getByPlaceholderText('기타 내용 입력...');
    expect(input.style.width).toBe('');
    expect(input).toHaveClass('w-full');
  });

  it('상세 입력이 선택 상자와 같은 왼쪽 기준선에 정렬된다', () => {
    renderMobile('detail');
    // 순위 라벨과 같은 폭의 보이지 않는 자리를 둬 select 와 왼쪽 끝을 맞춘다.
    const spacer = document.querySelector('[data-ranking-detail-spacer]');
    expect(spacer).not.toBeNull();
    expect(spacer).toHaveClass('invisible');
  });

  it('상세 입력 블록은 위아래 여백을 가진다', () => {
    renderMobile('detail');
    const block = document.querySelector('[data-ranking-detail-spacer]')?.parentElement;
    expect(block).toHaveClass('my-1');
  });
});
