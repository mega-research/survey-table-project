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
    // 폭은 셸(OptionTextRow label)이 담당하므로 입력과 셸 둘 다 인라인 폭이 없어야 한다.
    expect(input.style.width).toBe('');
    expect(input.closest('label')?.style.width ?? '').toBe('');
  });

  it('상세 기재 입력은 셸 안에서 남은 폭을 모두 차지한다', () => {
    renderMobile('detail');
    expect(screen.getByPlaceholderText('상세 기재')).toHaveClass('flex-1');
  });

  it('기타 직접 입력도 같은 규칙을 따른다', () => {
    renderMobile('__other__', true);
    const input = screen.getByPlaceholderText('기타 내용 입력...');
    expect(input.style.width).toBe('');
    expect(input.closest('label')?.style.width ?? '').toBe('');
    expect(input).toHaveClass('flex-1');
  });

  it('상세 입력은 순위 그리드 밖 아래 스택으로 렌더된다', () => {
    renderMobile('detail');
    const input = screen.getByPlaceholderText('상세 기재');
    const shell = input.closest('label');
    expect(shell).not.toBeNull();
    // 셸(OptionTextRow)이 순위 select 그리드 안(셀 옆·아래)이 아니라 그리드의 형제
    // 스택 컨테이너에 있다 — 상세 입력이 그리드 배치를 밀어내지 않는다.
    const trigger = screen.getByLabelText('1순위 선택');
    expect(shell?.parentElement?.contains(trigger)).toBe(false);
  });
});
