import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup } from '@/types/survey';
import { RankingOptCellTab } from '@/features/survey-builder/table-editor/cell-editor/ranking-opt-cell-tab';

// 기본 공통 props
function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    rankingLabel: '',
    onRankingLabelChange: vi.fn(),
    spssNumericCode: '' as const,
    onSpssNumericCodeChange: vi.fn(),
    isOtherRankingCell: false,
    onIsOtherRankingCellChange: vi.fn(),
    choiceGroups: [] as ChoiceGroup[],
    groupMemberCounts: {} as Record<string, number>,
    choiceGroupId: '',
    onChoiceGroupIdChange: vi.fn(),
    onChoiceGroupsChange: vi.fn(),
    answerQuoteText: '',
    onAnswerQuoteTextChange: vi.fn(),
    ...overrides,
  };
}

const rnk1: ChoiceGroup = { id: 'rg1', groupKey: 'rnk1', type: 'ranking', label: 'TV브랜드' };
const rnk2: ChoiceGroup = { id: 'rg2', groupKey: 'rnk2', type: 'ranking', label: '구매의향' };
const rad1: ChoiceGroup = { id: 'g1', groupKey: 'rad1', type: 'radio', label: '성별' };

describe('RankingOptCellTab — 순위 그룹 지정 UI', () => {
  it('ranking 타입 그룹만 드롭다운에 표시되고 radio 그룹은 노출되지 않는다', () => {
    render(
      <RankingOptCellTab
        {...makeProps({
          choiceGroups: [rnk1, rnk2, rad1],
          groupMemberCounts: { rg1: 2, rg2: 3, g1: 1 },
        })}
      />,
    );

    expect(screen.getByRole('option', { name: /TV브랜드/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /구매의향/ })).toBeInTheDocument();
    // radio 그룹은 표시 안 됨
    expect(screen.queryByRole('option', { name: /성별/ })).not.toBeInTheDocument();
  });

  it('멤버 수가 옵션에 포함된다', () => {
    render(
      <RankingOptCellTab
        {...makeProps({
          choiceGroups: [rnk1],
          groupMemberCounts: { rg1: 4 },
        })}
      />,
    );

    expect(screen.getByRole('option', { name: /셀 4/ })).toBeInTheDocument();
  });

  it('"+ 새 그룹 (rnk1)" 발번 문구가 나타난다', () => {
    render(
      <RankingOptCellTab
        {...makeProps({
          choiceGroups: [],
          groupMemberCounts: {},
        })}
      />,
    );

    expect(screen.getByRole('option', { name: /\+ 새 그룹 \(rnk1\)/ })).toBeInTheDocument();
  });

  it('"+ 새 그룹" 선택 시 type이 ranking인 새 그룹이 생성되고 onChoiceGroupIdChange가 호출된다', async () => {
    const onChoiceGroupsChange = vi.fn();
    const onChoiceGroupIdChange = vi.fn();

    render(
      <RankingOptCellTab
        {...makeProps({
          choiceGroups: [rnk1, rnk2],
          groupMemberCounts: { rg1: 2, rg2: 3 },
          onChoiceGroupsChange,
          onChoiceGroupIdChange,
        })}
      />,
    );

    const select = screen.getByRole('combobox', { name: /그룹/ });
    await userEvent.selectOptions(select, '__new__');

    expect(onChoiceGroupsChange).toHaveBeenCalledOnce();
    const newGroups: ChoiceGroup[] = onChoiceGroupsChange.mock.calls[0]![0] as ChoiceGroup[];
    expect(newGroups).toHaveLength(3);
    const newGroup = newGroups[2]!;
    expect(newGroup.groupKey).toBe('rnk3');
    expect(newGroup.type).toBe('ranking');

    expect(onChoiceGroupIdChange).toHaveBeenCalledWith(newGroup.id);
  });

  it('소속 그룹의 라벨 수정 시 onChoiceGroupsChange가 해당 그룹 label만 바꾼 배열로 호출된다', async () => {
    const onChoiceGroupsChange = vi.fn();

    render(
      <RankingOptCellTab
        {...makeProps({
          choiceGroups: [rnk1, rnk2],
          groupMemberCounts: { rg1: 2, rg2: 3 },
          choiceGroupId: 'rg1',
          onChoiceGroupsChange,
        })}
      />,
    );

    const labelInput = screen.getByPlaceholderText(/그룹 라벨/);
    await userEvent.type(labelInput, 'X');

    const lastCall: ChoiceGroup[] =
      onChoiceGroupsChange.mock.calls[onChoiceGroupsChange.mock.calls.length - 1]![0] as ChoiceGroup[];
    const updated = lastCall.find((g) => g.id === 'rg1')!;
    expect(updated.label).toContain('X');
    // rg2 는 그대로
    expect(lastCall.find((g) => g.id === 'rg2')!.label).toBe('구매의향');
  });

  it('"(그룹 없음)" 선택 시 onChoiceGroupIdChange("")가 호출된다', async () => {
    const onChoiceGroupIdChange = vi.fn();

    render(
      <RankingOptCellTab
        {...makeProps({
          choiceGroups: [rnk1],
          groupMemberCounts: { rg1: 1 },
          choiceGroupId: 'rg1',
          onChoiceGroupIdChange,
        })}
      />,
    );

    const select = screen.getByRole('combobox', { name: /그룹/ });
    await userEvent.selectOptions(select, '');

    expect(onChoiceGroupIdChange).toHaveBeenCalledWith('');
  });

  it('옵션 종류 세그먼트(라디오/체크박스/순위 버튼)가 없다', () => {
    render(<RankingOptCellTab {...makeProps()} />);

    expect(screen.queryByRole('button', { name: /라디오/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /체크박스/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /순위/ })).not.toBeInTheDocument();
  });

  it('순위 그룹 안내 문구가 표시된다', () => {
    render(<RankingOptCellTab {...makeProps()} />);

    expect(screen.getByText(/하나의 순위 select 세트/)).toBeInTheDocument();
  });
});
