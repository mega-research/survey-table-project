import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ChoiceGroup } from '@/types/survey';
import { ChoiceOptCellTab } from '@/components/survey-builder/choice-opt-cell-tab';

// 기본 공통 props (단일 radio 그룹 없는 초기 상태)
function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    choiceLabel: '',
    onChoiceLabelChange: vi.fn(),
    spssNumericCode: '' as const,
    onSpssNumericCodeChange: vi.fn(),
    allowTextInput: false,
    textInputType: 'text' as const,
    onTextInputTypeChange: vi.fn(),
    textInputNumberFormat: undefined,
    onTextInputNumberFormatChange: vi.fn(),
    onAllowTextInputChange: vi.fn(),
    branchRule: undefined,
    onBranchRuleChange: vi.fn(),
    allQuestions: [],
    currentQuestionId: 'q1',
    choiceGroups: [] as ChoiceGroup[],
    groupMemberCounts: {} as Record<string, number>,
    choiceGroupId: '',
    onChoiceGroupIdChange: vi.fn(),
    onChoiceGroupsChange: vi.fn(),
    questionRequired: false,
    answerQuoteText: '',
    onAnswerQuoteTextChange: vi.fn(),
    ...overrides,
  };
}

const rad1: ChoiceGroup = { id: 'g1', groupKey: 'rad1', type: 'radio', label: 'TV보유' };
const rad2: ChoiceGroup = { id: 'g2', groupKey: 'rad2', type: 'radio', label: '구매의향' };

describe('ChoiceOptCellTab — 옵션 그룹 지정 UI', () => {
  it('그룹 목록에 멤버 수가 포함된 옵션이 표시된다', () => {
    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [rad1, rad2],
          groupMemberCounts: { g1: 2, g2: 3 },
        })}
      />,
    );

    // select 옵션에 그룹 라벨과 셀 수가 있어야 한다
    expect(screen.getByRole('option', { name: /TV보유/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /셀 2/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /구매의향/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /셀 3/ })).toBeInTheDocument();
  });

  it('"+ 새 그룹" 선택 시 onChoiceGroupsChange와 onChoiceGroupIdChange가 새 그룹으로 호출된다', async () => {
    const onChoiceGroupsChange = vi.fn();
    const onChoiceGroupIdChange = vi.fn();

    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [rad1, rad2],
          groupMemberCounts: { g1: 2, g2: 3 },
          onChoiceGroupsChange,
          onChoiceGroupIdChange,
        })}
      />,
    );

    const select = screen.getByRole('combobox', { name: /그룹/ });
    await userEvent.selectOptions(select, '__new__');

    // 새 그룹이 choiceGroups 에 추가되어야 한다
    expect(onChoiceGroupsChange).toHaveBeenCalledOnce();
    const newGroups: ChoiceGroup[] = onChoiceGroupsChange.mock.calls[0]![0] as ChoiceGroup[];
    expect(newGroups).toHaveLength(3);
    const newGroup = newGroups[2]!;
    expect(newGroup.groupKey).toBe('rad3');
    expect(newGroup.type).toBe('radio');

    // onChoiceGroupIdChange 는 새 그룹 id 로 호출되어야 한다
    expect(onChoiceGroupIdChange).toHaveBeenCalledWith(newGroup.id);
  });

  it('소속 그룹의 라벨 수정 시 onChoiceGroupsChange가 해당 그룹 label만 바꾼 배열로 호출된다', async () => {
    const onChoiceGroupsChange = vi.fn();

    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [rad1, rad2],
          groupMemberCounts: { g1: 2, g2: 3 },
          choiceGroupId: 'g1',
          onChoiceGroupsChange,
        })}
      />,
    );

    // 라벨 input 에 문자를 추가로 타이핑하면 onChange 가 호출되어야 한다.
    // 컴포넌트가 controlled(value=currentGroup.label)이므로 type 이벤트 1개로 검증한다.
    const labelInput = screen.getByPlaceholderText(/그룹 라벨/);
    await userEvent.type(labelInput, 'X');

    // 마지막 호출에서 g1 의 label 에 'X' 가 추가되어야 한다
    const lastCall: ChoiceGroup[] =
      onChoiceGroupsChange.mock.calls[onChoiceGroupsChange.mock.calls.length - 1]![0] as ChoiceGroup[];
    const updated = lastCall.find((g) => g.id === 'g1')!;
    expect(updated.label).toContain('X');
    // g2 는 그대로
    expect(lastCall.find((g) => g.id === 'g2')!.label).toBe('구매의향');
  });

  it('"(그룹 없음)" 선택 시 onChoiceGroupIdChange("")가 호출된다', async () => {
    const onChoiceGroupIdChange = vi.fn();

    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [rad1],
          groupMemberCounts: { g1: 1 },
          choiceGroupId: 'g1',
          onChoiceGroupIdChange,
        })}
      />,
    );

    const select = screen.getByRole('combobox', { name: /그룹/ });
    await userEvent.selectOptions(select, '');

    expect(onChoiceGroupIdChange).toHaveBeenCalledWith('');
  });

  it('순위 세그먼트 버튼이 존재하지 않는다 (ranking_opt 전용으로 이동)', () => {
    render(<ChoiceOptCellTab {...makeProps()} />);

    // 라디오·체크박스 버튼은 활성
    const checkboxBtn = screen.getByRole('button', { name: /체크박스/ });
    expect(checkboxBtn).not.toBeDisabled();
    // 순위 버튼은 제거됨
    expect(screen.queryByRole('button', { name: /순위/ })).not.toBeInTheDocument();
  });

  it('초기 상태에서 라디오 버튼이 aria-pressed="true"다', () => {
    render(<ChoiceOptCellTab {...makeProps()} />);

    const radioBtn = screen.getByRole('button', { name: /라디오/ });
    const checkboxBtn = screen.getByRole('button', { name: /체크박스/ });
    expect(radioBtn).toHaveAttribute('aria-pressed', 'true');
    expect(checkboxBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('체크박스 버튼 클릭 시 드롭다운이 checkbox 그룹만 표시하고 "+ 새 그룹 (cb1)" 발번 문구가 나타난다', async () => {
    const cb1: ChoiceGroup = { id: 'cg1', groupKey: 'cb1', type: 'checkbox', label: '구매품목' };
    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [rad1, rad2, cb1],
          groupMemberCounts: { g1: 2, g2: 3, cg1: 1 },
        })}
      />,
    );

    const checkboxBtn = screen.getByRole('button', { name: /체크박스/ });
    await userEvent.click(checkboxBtn);

    // 체크박스 그룹만 드롭다운에 표시되어야 한다
    expect(screen.getByRole('option', { name: /구매품목/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /TV보유/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /구매의향/ })).not.toBeInTheDocument();

    // "+ 새 그룹"에 cb2 발번 문구가 있어야 한다
    expect(screen.getByRole('option', { name: /\+ 새 그룹 \(cb2\)/ })).toBeInTheDocument();
  });

  it('체크박스 세그먼트에서 "+ 새 그룹" 선택 시 type이 checkbox인 cb1 그룹이 생성된다', async () => {
    const onChoiceGroupsChange = vi.fn();
    const onChoiceGroupIdChange = vi.fn();

    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [rad1, rad2],
          groupMemberCounts: { g1: 2, g2: 3 },
          onChoiceGroupsChange,
          onChoiceGroupIdChange,
        })}
      />,
    );

    // 체크박스 세그먼트로 전환
    const checkboxBtn = screen.getByRole('button', { name: /체크박스/ });
    await userEvent.click(checkboxBtn);

    // "+ 새 그룹 (cb1)" 선택
    const select = screen.getByRole('combobox', { name: /그룹/ });
    await userEvent.selectOptions(select, '__new__');

    // 새 그룹이 checkbox type, cb1 groupKey로 생성되어야 한다
    expect(onChoiceGroupsChange).toHaveBeenCalledOnce();
    const newGroups: ChoiceGroup[] = onChoiceGroupsChange.mock.calls[0]![0] as ChoiceGroup[];
    const newGroup = newGroups[newGroups.length - 1]!;
    expect(newGroup.type).toBe('checkbox');
    expect(newGroup.groupKey).toBe('cb1');

    expect(onChoiceGroupIdChange).toHaveBeenCalledWith(newGroup.id);
  });

  it('라디오에서 체크박스로 종류 전환 시 onChoiceGroupIdChange("")가 호출된다', async () => {
    const onChoiceGroupIdChange = vi.fn();

    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [rad1],
          groupMemberCounts: { g1: 1 },
          choiceGroupId: 'g1',
          onChoiceGroupIdChange,
        })}
      />,
    );

    const checkboxBtn = screen.getByRole('button', { name: /체크박스/ });
    await userEvent.click(checkboxBtn);

    // 다른 type 그룹에 남지 않도록 소속 해제 호출
    expect(onChoiceGroupIdChange).toHaveBeenCalledWith('');
  });

  it('cb 그룹 소속 셀로 열리면 세그먼트가 체크박스 선택 상태(aria-pressed)로 초기화된다', () => {
    const cb1: ChoiceGroup = { id: 'cg1', groupKey: 'cb1', type: 'checkbox', label: '구매품목' };

    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [rad1, cb1],
          groupMemberCounts: { g1: 2, cg1: 1 },
          choiceGroupId: 'cg1',
        })}
      />,
    );

    const radioBtn = screen.getByRole('button', { name: /라디오/ });
    const checkboxBtn = screen.getByRole('button', { name: /체크박스/ });
    expect(checkboxBtn).toHaveAttribute('aria-pressed', 'true');
    expect(radioBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('체크박스 종류에서 안내 문구가 체크박스용으로 바뀐다', async () => {
    render(<ChoiceOptCellTab {...makeProps()} />);

    // 초기(라디오) 안내문
    expect(screen.getByText(/하나만 선택됩니다/)).toBeInTheDocument();

    // 체크박스로 전환
    await userEvent.click(screen.getByRole('button', { name: /체크박스/ }));

    expect(screen.getByText(/여러 개를 선택할 수 있습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/하나만 선택됩니다/)).not.toBeInTheDocument();
  });
});
