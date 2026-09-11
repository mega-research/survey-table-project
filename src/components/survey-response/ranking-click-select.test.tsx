/**
 * 순위형 "보기 클릭" 목록(수동 보기) — 클릭·해제·초기화·행 안 입력칸.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PriorAnswersProvider } from '@/lib/survey/prior-answers-context';
import type { QuestionOption, RankingAnswer } from '@/types/survey';

import { RankingClickList } from './ranking-click-select';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => false,
  useMediaQuery: () => false,
}));

const options: QuestionOption[] = [
  { id: 'a', value: 'a', label: '성능 우수' },
  { id: 'b', value: 'b', label: '가격 경쟁력' },
  { id: 'c', value: 'c', label: '상세 사유', allowTextInput: true, textInputPlaceholder: '사유 입력' },
];

function renderList(answers: RankingAnswer[], extra: Partial<Parameters<typeof RankingClickList>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <RankingClickList
      answers={answers}
      options={options}
      positions={2}
      allowOther={false}
      onChange={onChange}
      detailTargetScopeId="q1"
      questionId="q1"
      {...extra}
    />,
  );
  return onChange;
}

describe('RankingClickList', () => {
  it('보기를 누르면 비어 있는 가장 낮은 순위로 onChange 한다', () => {
    const onChange = renderList([{ rank: 1, optionValue: 'a' }]);
    fireEvent.click(screen.getByRole('button', { name: '가격 경쟁력' }));
    expect(onChange).toHaveBeenCalledWith([
      { rank: 1, optionValue: 'a' },
      { rank: 2, optionValue: 'b' },
    ]);
  });

  it('선택된 보기에는 순위 배지와 aria-pressed 가 붙는다', () => {
    renderList([{ rank: 2, optionValue: 'b' }]);
    const row = screen.getByRole('button', { name: '가격 경쟁력' });
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(row).toHaveTextContent('2순위');
    expect(screen.getByRole('button', { name: '성능 우수' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('키보드 Enter/Space 로도 누를 수 있다', () => {
    const onChange = renderList([]);
    fireEvent.keyDown(screen.getByRole('button', { name: '성능 우수' }), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([{ rank: 1, optionValue: 'a' }]);
  });

  it('순위초기화는 전부 비우고, 비어 있으면 눌리지 않는다', () => {
    const onChange = renderList([{ rank: 1, optionValue: 'a' }]);
    fireEvent.click(screen.getByRole('button', { name: '순위초기화' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('순위가 없으면 순위초기화가 비활성이다', () => {
    renderList([]);
    expect(screen.getByRole('button', { name: '순위초기화' })).toBeDisabled();
  });

  it('상세기재 보기의 입력칸은 순위가 매겨지기 전엔 없다', () => {
    renderList([]);
    expect(screen.queryByPlaceholderText('사유 입력')).toBeNull();
  });

  it('순위가 매겨지면 입력 줄이 보기 목록 아래에 라벨 칩과 함께 나온다', () => {
    renderList([{ rank: 1, optionValue: 'c' }]);
    const input = screen.getByPlaceholderText('사유 입력');
    // 보기 행(role=button) 안이 아니다
    expect(screen.getByRole('button', { name: '상세 사유' }).contains(input)).toBe(false);
    expect(input.closest('label')?.textContent).toContain('상세 사유');
  });

  it('순위가 매겨진 상세기재 입력은 optionText 를 그 순위 항목에 쓰고 검증 타깃 id 를 단다', () => {
    const onChange = renderList([{ rank: 1, optionValue: 'c' }]);
    const input = screen.getByPlaceholderText('사유 입력');
    expect(input).toHaveAttribute('data-option-text-target-id', 'q1:ranking:1:c');

    fireEvent.change(input, { target: { value: '납기' } });
    expect(onChange).toHaveBeenCalledWith([{ rank: 1, optionValue: 'c', optionText: '납기' }]);
  });

  it('allowOther 면 기타 행이 마지막에 붙고 otherText 로 저장한다', () => {
    const onChange = renderList([{ rank: 1, optionValue: '__other__' }], { allowOther: true });
    const input = screen.getByPlaceholderText('기타 내용 입력...');
    expect(input.closest('label')?.textContent).toContain('기타');
    expect(input).toHaveAttribute('data-option-text-target-id', 'q1:ranking:1:__other__');
    fireEvent.change(input, { target: { value: '직접' } });
    expect(onChange).toHaveBeenCalledWith([{ rank: 1, optionValue: '__other__', otherText: '직접' }]);
    // 요약 칩은 기타를 마지막 번호로 보여준다
    expect(screen.getByLabelText('1순위 선택')).toHaveTextContent('4');
  });

  it('순위가 다 찼으면 다른 보기를 눌러도 바뀌지 않고 안내를 띄운다', () => {
    const onChange = renderList([
      { rank: 1, optionValue: 'a' },
      { rank: 2, optionValue: 'b' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: '상세 사유' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('2순위까지 모두 선택했습니다');
  });

  it('이월 값과 같은 순위 선택은 빨갛게 표시한다', () => {
    render(
      <PriorAnswersProvider
        answers={{ q1: [{ rank: 1, optionValue: 'a' }] }}
        confirmAnswers={null}
        highlightAnswers={{ q1: [{ rank: 1, optionValue: 'a' }] }}
        waveLabel={undefined}
        changeConfirmEnabled={false}
      >
        <RankingClickList
          answers={[{ rank: 1, optionValue: 'a' }]}
          options={options}
          positions={2}
          allowOther={false}
          onChange={vi.fn()}
          questionId="q1"
        />
      </PriorAnswersProvider>,
    );
    expect(screen.getByRole('button', { name: '성능 우수' })).toHaveClass('text-red-600');
    expect(screen.getByLabelText('1순위 선택')).toHaveClass('text-red-600');
  });
});
