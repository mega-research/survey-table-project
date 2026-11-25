import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChoiceOptCellTab } from '@/features/survey-builder/table-editor/cell-editor/choice-opt-cell-tab';
import type { ChoiceGroup } from '@/types/survey';

/**
 * 보기 칸 편집의 보기 모양 안내 — 네 모양이 어느 화면에 적용되는지, 슬라이더를 고르면 무엇이 달라지는지,
 * 슬라이더로 못 그리는 행이 어디인지를 고르는 자리에서 알린다(CONTEXT.md 「척도 슬라이더」).
 */

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
    exclusiveChoice: false,
    onExclusiveChoiceChange: vi.fn(),
    exclusiveScope: 'group' as const,
    onExclusiveScopeChange: vi.fn(),
    excludeFromMean: false,
    onExcludeFromMeanChange: vi.fn(),
    parentQuestionType: undefined,
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

const rad: ChoiceGroup = { id: 'g1', groupKey: 'rad1', type: 'radio', label: '만족도' };
const sliderGroup: ChoiceGroup = { ...rad, scaleSlider: 'positive-right' };
const cb: ChoiceGroup = { id: 'g2', groupKey: 'cb1', type: 'checkbox', label: '이용 경험' };

const viewButton = (name: string) => screen.getByRole('button', { name });
const textInput = {
  reason: 'text-input' as const,
  message: '「선택 시 텍스트 입력 받기」가 켜진 보기가 있습니다.',
  rowLabels: ['회의실 지원'],
};

describe('ChoiceOptCellTab — 보기 모양의 적용 범위', () => {
  afterEach(cleanup);

  it('구역 제목이 모바일 이야기가 아니다 — 슬라이더는 웹에도 적용된다', () => {
    render(<ChoiceOptCellTab {...makeProps({ choiceGroups: [rad], choiceGroupId: 'g1' })} />);
    expect(screen.getByRole('group', { name: '보기 모양 (rad1)' })).toBeInTheDocument();
    expect(screen.queryByText(/모바일 그룹 카드에서 보기 모양/)).toBeNull();
  });

  it('네 모양마다 적용 범위가 적혀 있다 — 셋은 모바일만, 슬라이더는 웹과 모바일', () => {
    render(<ChoiceOptCellTab {...makeProps({ choiceGroups: [rad], choiceGroupId: 'g1' })} />);
    // 설명은 적용 범위로 시작한다 — 슬라이더의 설명 본문에도 「웹과 모바일」이 있어 첫머리를 본다
    for (const name of ['세로 타일', '원본 한 줄', '척도 막대']) {
      expect(viewButton(name)).toHaveAccessibleDescription(/^모바일만/);
      expect(viewButton(name)).not.toHaveAccessibleDescription(/웹/);
    }
    expect(viewButton('척도 슬라이더')).toHaveAccessibleDescription(/^웹과 모바일/);
    expect(viewButton('척도 슬라이더')).not.toHaveAccessibleDescription(/모바일만/);
  });

  it('슬라이더의 설명이 표가 웹에서도 행 단위로 그려진다고 알린다 — 고르기 전에도 보인다', () => {
    render(<ChoiceOptCellTab {...makeProps({ choiceGroups: [rad], choiceGroupId: 'g1' })} />);
    expect(viewButton('척도 슬라이더')).toHaveAccessibleDescription(/행 단위로 그려집니다/);
  });

  it('체크박스 묶음에는 슬라이더의 설명도 없다 — 고를 수 없는 모양은 적지 않는다', () => {
    render(<ChoiceOptCellTab {...makeProps({ choiceGroups: [cb], choiceGroupId: 'g2' })} />);
    const section = screen.getByRole('group', { name: '보기 모양 (cb1)' }).parentElement!;
    expect(within(section).queryByText(/웹과 모바일/)).toBeNull();
    expect(within(section).getAllByText('모바일만')).toHaveLength(3);
  });

  it('모바일 세 모양이 어느 표시 방식에서 적용되는지는 그대로 적혀 있다', () => {
    render(<ChoiceOptCellTab {...makeProps({ choiceGroups: [rad], choiceGroupId: 'g1' })} />);
    expect(screen.getByText(/「행별 척도」일 때 적용됩니다/)).toBeInTheDocument();
  });
});

describe('ChoiceOptCellTab — 슬라이더 묶음의 긍정 방향 설명과 폴백 경고', () => {
  afterEach(cleanup);

  it('긍정 방향에 색 설명이 이어져 있다 — 문항 설정의 것과 같은 조각이다', () => {
    render(
      <ChoiceOptCellTab {...makeProps({ choiceGroups: [sliderGroup], choiceGroupId: 'g1' })} />,
    );
    expect(screen.getByRole('group', { name: '긍정 방향' })).toHaveAccessibleDescription(
      /붉은색.*푸른색/,
    );
  });

  it('폴백 행이 있으면 경고 상자에 이유와 행 이름이 보인다', () => {
    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [sliderGroup],
          choiceGroupId: 'g1',
          scaleSliderDiagnosis: { issues: [textInput], drawsNothing: false },
        })}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(textInput.message);
    expect(alert).toHaveTextContent('회의실 지원');
    expect(alert).not.toHaveTextContent('화면은 바뀌지 않습니다');
  });

  it('모든 행이 폴백이면 화면이 바뀌지 않는다는 한 줄이 보인다', () => {
    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [sliderGroup],
          choiceGroupId: 'g1',
          scaleSliderDiagnosis: { issues: [textInput], drawsNothing: true },
        })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('이 표의 화면은 바뀌지 않습니다');
  });

  it('문제가 없으면 상자가 없다', () => {
    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [sliderGroup],
          choiceGroupId: 'g1',
          scaleSliderDiagnosis: { issues: [], drawsNothing: false },
        })}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('슬라이더를 고르지 않은 묶음은 진단이 넘어와도 경고하지 않는다', () => {
    render(
      <ChoiceOptCellTab
        {...makeProps({
          choiceGroups: [rad],
          choiceGroupId: 'g1',
          scaleSliderDiagnosis: { issues: [textInput], drawsNothing: true },
        })}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ChoiceOptCellTab — 「평균에서 제외」의 슬라이더 문구', () => {
  afterEach(cleanup);

  it('스위치 옆에 척도 슬라이더에서는 체크로 떨어진다고 적혀 있다', () => {
    render(<ChoiceOptCellTab {...makeProps({ choiceGroups: [rad], choiceGroupId: 'g1' })} />);
    expect(screen.getByRole('switch', { name: '평균에서 제외' })).toHaveAccessibleDescription(
      /척도 슬라이더에서는 .*체크로 떨어집니다/,
    );
  });
});
