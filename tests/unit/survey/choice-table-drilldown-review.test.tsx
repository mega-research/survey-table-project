import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import { QuestionInput } from '@/components/survey-response/question-input';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question } from '@/types/survey';

const { contactAttrs } = vi.hoisted(() => ({
  contactAttrs: { current: {} as Record<string, string> },
}));

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/lib/survey/contact-attrs-context', () => ({
  useContactAttrs: () => contactAttrs.current,
}));

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  contactAttrs.current = {};
  useSurveyResponseStore.getState().resetResponseState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function controlledChoice({
  question,
  initialValue,
  onValue = () => {},
}: {
  question: Question;
  initialValue: unknown;
  onValue?: (value: unknown) => void;
}) {
  function ControlledChoice() {
    const [value, setValue] = useState(initialValue);
    return (
      <ChoiceTableResponse
        question={question}
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue(next);
        }}
      />
    );
  }

  return render(<ControlledChoice />);
}

function plainRadioQuestion(): Question {
  return {
    id: 'q-radio-review',
    type: 'radio',
    title: '라디오',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'drilldown-original-row',
    mobileDrilldownOmitLeadingColumns: 1,
    tableColumns: [
      { id: 'label', label: '항목' },
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    tableRowsData: [
      {
        id: 'radio-row',
        label: '',
        cells: [
          { id: 'radio-label', type: 'text', content: '라디오 행' },
          { id: 'radio-a', type: 'choice_opt', content: '', choiceLabel: '라디오 A' },
          { id: 'radio-b', type: 'choice_opt', content: '', choiceLabel: '라디오 B' },
        ],
      },
    ],
  } as Question;
}

function groupedQuestion(): Question {
  return {
    id: 'q-group-review',
    type: 'radio',
    title: '그룹 선택',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'drilldown-original-row',
    mobileDrilldownOmitLeadingColumns: 1,
    tableColumns: [
      { id: 'label', label: '항목' },
      { id: 'ra', label: 'RA' },
      { id: 'rb', label: 'RB' },
      { id: 'ca', label: 'CA' },
      { id: 'cb', label: 'CB' },
    ],
    tableRowsData: [
      {
        id: 'group-row',
        label: '',
        cells: [
          { id: 'group-label', type: 'text', content: '그룹 행' },
          {
            id: 'group-radio-a',
            type: 'choice_opt',
            content: '',
            choiceLabel: '그룹 라디오 A',
            choiceGroupId: 'radio-group',
          },
          {
            id: 'group-radio-b',
            type: 'choice_opt',
            content: '',
            choiceLabel: '그룹 라디오 B',
            choiceGroupId: 'radio-group',
          },
          {
            id: 'group-check-a',
            type: 'choice_opt',
            content: '',
            choiceLabel: '그룹 체크 A',
            choiceGroupId: 'check-group',
          },
          {
            id: 'group-check-b',
            type: 'choice_opt',
            content: '',
            choiceLabel: '그룹 체크 B',
            choiceGroupId: 'check-group',
          },
        ],
      },
    ],
    choiceGroups: [
      { id: 'radio-group', type: 'radio', groupKey: 'radio', label: '라디오' },
      { id: 'check-group', type: 'checkbox', groupKey: 'check', label: '체크' },
    ],
  } as unknown as Question;
}

function limitedCheckboxQuestion(): Question {
  return {
    id: 'q-limit-review',
    type: 'checkbox',
    title: '제한 선택',
    required: false,
    order: 0,
    minSelections: 2,
    maxSelections: 2,
    mobileTableDisplayMode: 'drilldown-original-row',
    mobileDrilldownOmitLeadingColumns: 1,
    tableColumns: [
      { id: 'label', label: '항목' },
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
    tableRowsData: [
      {
        id: 'limit-row',
        label: '',
        cells: [
          { id: 'limit-label', type: 'text', content: '제한 행' },
          { id: 'limit-a', type: 'choice_opt', content: '', choiceLabel: '제한 A' },
          { id: 'limit-b', type: 'choice_opt', content: '', choiceLabel: '제한 B' },
          { id: 'limit-c', type: 'choice_opt', content: '', choiceLabel: '제한 C' },
        ],
      },
    ],
  } as Question;
}

function textInputQuestion(): Question {
  return {
    id: 'q-text-review',
    type: 'checkbox',
    title: '상세 입력',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'drilldown-original-row',
    mobileDrilldownOmitLeadingColumns: 1,
    tableColumns: [
      { id: 'label', label: '항목' },
      { id: 'choice', label: '선택' },
    ],
    tableRowsData: [
      {
        id: 'text-row',
        label: '',
        cells: [
          { id: 'text-label', type: 'text', content: '상세 행' },
          {
            id: 'text-choice',
            type: 'choice_opt',
            content: '',
            choiceLabel: '상세 선택',
            allowTextInput: true,
            textInputPlaceholder: '사유 입력',
          },
        ],
      },
    ],
  } as Question;
}

function complexQuestion({ hiddenSection = false } = {}): Question {
  const sectionContent = hiddenSection ? '노출 금지 섹션' : '성과 {{primary}}';
  return {
    id: hiddenSection ? 'q-hidden-hierarchy' : 'q-hierarchy',
    type: 'checkbox',
    title: '복합 선택',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'drilldown-original-row',
    mobileDrilldownOmitLeadingColumns: 2,
    tableColumns: [
      { id: 'section', label: '섹션', width: 140 },
      { id: 'item', label: '항목', width: 140 },
      { id: 'active', label: '활성', width: 160 },
      { id: 'return', label: '재방문', width: 160 },
    ],
    tableRowsData: [
      {
        id: 'complex-row-1',
        label: '행 label 폴백 1',
        cells: [
          {
            id: 'complex-section',
            type: 'text',
            content: sectionContent,
            rowspan: 2,
            ...(hiddenSection ? { mobileDisplay: 'hidden' as const } : {}),
          },
          {
            id: 'complex-item-1',
            type: 'text',
            content: hiddenSection ? '첫 공개 항목' : '첫 {{primary}}',
          },
          {
            id: 'complex-active-1',
            type: 'choice_opt',
            content: '',
            choiceLabel: '첫 활성',
          },
          {
            id: 'complex-return-1',
            type: 'choice_opt',
            content: '',
            choiceLabel: '첫 재방문',
          },
        ],
      },
      {
        id: 'complex-row-2',
        label: '행 label 폴백 2',
        cells: [
          {
            id: 'complex-section-continuation',
            type: 'text',
            content: '',
            isHidden: true,
            _isContinuation: true,
          },
          {
            id: 'complex-item-2',
            type: 'text',
            content: hiddenSection ? '둘째 공개 항목' : '둘째 {{primary}}',
          },
          {
            id: 'complex-active-2',
            type: 'choice_opt',
            content: '',
            choiceLabel: '둘째 활성',
          },
          {
            id: 'complex-return-2',
            type: 'choice_opt',
            content: '',
            choiceLabel: '둘째 재방문',
          },
        ],
      },
    ],
  } as Question;
}

function enterSingleRow(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
}

function getHeaderScroller(): HTMLElement {
  const scroller = screen.getAllByRole('columnheader')[0]?.parentElement?.parentElement;
  if (!(scroller instanceof HTMLElement)) throw new Error('헤더 스크롤 컨테이너가 없습니다.');
  return scroller;
}

describe('선택 행 상세 응답 shape와 validation', () => {
  it('비그룹 radio는 null에서 cell.id string으로 선택하고 다른 cell로 배타 교체한다', () => {
    const onValue = vi.fn();
    controlledChoice({ question: plainRadioQuestion(), initialValue: null, onValue });
    enterSingleRow('라디오 행');

    const radioA = screen.getByRole('radio', { name: '라디오 A' });
    const radioB = screen.getByRole('radio', { name: '라디오 B' });
    expect(radioA).not.toBeChecked();
    expect(radioB).not.toBeChecked();

    fireEvent.click(radioA);
    expect(onValue).toHaveBeenLastCalledWith('radio-a');
    expect(radioA).toBeChecked();
    expect(radioB).not.toBeChecked();

    fireEvent.click(radioB);
    expect(onValue).toHaveBeenLastCalledWith('radio-b');
    expect(radioA).not.toBeChecked();
    expect(radioB).toBeChecked();
  });

  it('grouped radio는 string 값을 교체하고 grouped checkbox는 배열에서 해제한다', () => {
    const onValue = vi.fn();
    controlledChoice({
      question: groupedQuestion(),
      initialValue: {
        radio: 'group-radio-a',
        check: ['group-check-a', 'group-check-b'],
      },
      onValue,
    });
    enterSingleRow('그룹 행');

    fireEvent.click(screen.getByRole('radio', { name: '그룹 라디오 B' }));
    expect(onValue).toHaveBeenLastCalledWith({
      radio: 'group-radio-b',
      check: ['group-check-a', 'group-check-b'],
    });
    expect(screen.getByRole('radio', { name: '그룹 라디오 A' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '그룹 라디오 B' })).toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: '그룹 체크 A' }));
    expect(onValue).toHaveBeenLastCalledWith({
      radio: 'group-radio-b',
      check: ['group-check-b'],
    });
  });

  it('checkbox는 max에서 추가를 막고 min 충족 시 경고를 지운다', () => {
    const onValue = vi.fn();
    controlledChoice({ question: limitedCheckboxQuestion(), initialValue: [], onValue });
    expect(screen.getByText('최소 2개 이상 선택해주세요')).toBeInTheDocument();
    enterSingleRow('제한 행');

    fireEvent.click(screen.getByRole('checkbox', { name: '제한 A' }));
    expect(screen.getByText('최소 2개 이상 선택해주세요')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '제한 B' }));

    expect(screen.queryByText('최소 2개 이상 선택해주세요')).toBeNull();
    expect(screen.getByText('2/2개 선택됨')).toBeInTheDocument();
    const blocked = screen.getByRole('checkbox', { name: '제한 C' });
    expect(blocked).toBeDisabled();
    fireEvent.click(blocked);
    expect(onValue).toHaveBeenCalledTimes(2);
    expect(onValue).toHaveBeenLastCalledWith(['limit-a', 'limit-b']);
  });

  it('allowTextInput은 선택 시 표시되고 optionTexts 값을 갱신한다', () => {
    controlledChoice({ question: textInputQuestion(), initialValue: [] });
    enterSingleRow('상세 행');
    expect(screen.queryByPlaceholderText('사유 입력')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: '상세 선택' }));
    const input = screen.getByPlaceholderText('사유 입력');
    fireEvent.change(input, { target: { value: '직접 작성한 사유' } });

    expect(input).toHaveValue('직접 작성한 사유');
    expect(useSurveyResponseStore.getState().getOptionText('q-text-review', 'text-choice')).toBe(
      '직접 작성한 사유',
    );
  });

  it('ranking은 drilldown-original-row 설정을 소비하지 않고 기존 ranking UI를 렌더한다', () => {
    const question: Question = {
      id: 'q-ranking-review',
      type: 'ranking',
      title: '순위',
      required: false,
      order: 0,
      mobileTableDisplayMode: 'drilldown-original-row',
      mobileDrilldownOmitLeadingColumns: 1,
      rankingConfig: { optionsSource: 'table', positions: 1 },
      tableColumns: [
        { id: 'label', label: '항목' },
        { id: 'ranking', label: '순위' },
      ],
      tableRowsData: [
        {
          id: 'ranking-row',
          label: '',
          cells: [
            { id: 'ranking-label', type: 'text', content: '순위 항목' },
            {
              id: 'ranking-option',
              type: 'ranking_opt',
              content: '순위 옵션',
              rankingLabel: '순위 옵션',
            },
          ],
        },
      ],
    } as Question;

    render(<QuestionInput question={question} value={[]} onChange={vi.fn()} />);
    expect(screen.getByLabelText('1순위 선택')).toBeInTheDocument();
    expect(screen.queryByText('작성할 항목을 선택하세요')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('선택 행 상세 복합 테이블 통합', () => {
  it('rowspan section에서 원본 행마다 leaf 카드 하나만 만들고 breadcrumb 제목 우선순위를 유지한다', () => {
    contactAttrs.current = { primary: '{{secondary}}', secondary: '두 번 치환 금지' };
    render(<ChoiceTableResponse question={complexQuestion()} value={[]} onChange={vi.fn()} />);

    const sectionCard = screen.getByRole('button', { name: /성과 \{\{secondary\}\}/ });
    expect(screen.queryByText('두 번 치환 금지')).toBeNull();
    fireEvent.click(sectionCard);

    expect(screen.getByText('성과 {{secondary}}')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /첫 \{\{secondary\}\}|둘째 \{\{secondary\}\}/ }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: /첫 활성|첫 재방문|둘째 활성|둘째 재방문/ }),
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /첫 \{\{secondary\}\}/ }));
    expect(screen.getByText('첫 {{secondary}}')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByText('행 label 폴백 1')).toBeNull();
  });

  it('hidden omitted section text는 제목에 새지 않고 공개 item 제목을 사용한다', () => {
    render(
      <ChoiceTableResponse
        question={complexQuestion({ hiddenSection: true })}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('노출 금지 섹션')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^항목/ }));
    expect(screen.getByRole('button', { name: /첫 공개 항목/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /둘째 공개 항목/ })).toBeInTheDocument();
    expect(screen.queryByText('노출 금지 섹션')).toBeNull();
  });

  it('실제 상세 unmount/remount 간 scroll을 공유하고 root 복귀 후 0으로 초기화한다', () => {
    contactAttrs.current = { primary: '팀 A' };
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
    render(<ChoiceTableResponse question={complexQuestion()} value={[]} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /성과 팀 A/ }));
    fireEvent.click(screen.getByRole('button', { name: /첫 팀 A/ }));
    const firstBodyScroller = screen.getByTestId('table-preview-scroll');
    const firstHeaderScroller = getHeaderScroller();
    firstBodyScroller.scrollLeft = 96;
    fireEvent.scroll(firstBodyScroller);
    expect(firstHeaderScroller.scrollLeft).toBe(96);

    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    fireEvent.click(screen.getByRole('button', { name: /둘째 팀 A/ }));
    const secondBodyScroller = screen.getByTestId('table-preview-scroll');
    const secondHeaderScroller = getHeaderScroller();
    expect(secondBodyScroller).not.toBe(firstBodyScroller);
    expect(secondBodyScroller.scrollLeft).toBe(96);
    expect(secondHeaderScroller.scrollLeft).toBe(96);

    fireEvent.click(screen.getByRole('button', { name: '목차로' }));
    fireEvent.click(screen.getByRole('button', { name: /성과 팀 A/ }));
    fireEvent.click(screen.getByRole('button', { name: /첫 팀 A/ }));
    expect(screen.getByTestId('table-preview-scroll').scrollLeft).toBe(0);
    expect(getHeaderScroller().scrollLeft).toBe(0);
  });
});
