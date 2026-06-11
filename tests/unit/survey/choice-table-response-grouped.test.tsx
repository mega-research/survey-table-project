/**
 * 그룹별 선택 radio (choiceGroups) 렌더 동작 테스트
 *
 * 픽스처: rad1(cellA, cellB), rad2(cellC), 미소속(cellD)
 * Step 1 — 실패 테스트 먼저 작성 (TDD Red 단계)
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Question } from '@/types/survey';
import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';

// 모바일 강제 — TablePreview(ResizeObserver 의존) 우회
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));

/**
 * 그룹별 선택 radio 질문 픽스처.
 * - rad1: cellA, cellB
 * - rad2: cellC
 * - 미소속(default): cellD
 */
function groupedRadioQuestion(): Question {
  return {
    id: 'qg',
    type: 'radio',
    title: '그룹 라디오',
    required: true,
    order: 0,
    tableColumns: [
      { id: 'col1', label: '그룹1' },
      { id: 'col2', label: '그룹2' },
      { id: 'col3', label: '미소속' },
    ],
    tableRowsData: [
      {
        id: 'row1',
        label: '',
        cells: [
          {
            id: 'cellA',
            type: 'choice_opt',
            content: '',
            choiceLabel: '보기A',
            choiceGroupId: 'grp1',
          },
          {
            id: 'cellB',
            type: 'choice_opt',
            content: '',
            choiceLabel: '보기B',
            choiceGroupId: 'grp1',
          },
          {
            id: 'cellC',
            type: 'choice_opt',
            content: '',
            choiceLabel: '보기C',
            choiceGroupId: 'grp2',
          },
          {
            id: 'cellD',
            type: 'choice_opt',
            content: '',
            choiceLabel: '보기D',
            // choiceGroupId 없음 — 미소속
          },
        ],
      },
    ],
    choiceGroups: [
      { id: 'grp1', type: 'radio', groupKey: 'rad1', label: '그룹1' },
      { id: 'grp2', type: 'radio', groupKey: 'rad2', label: '그룹2' },
    ],
  } as unknown as Question;
}

describe('ChoiceTableResponse — 그룹별 선택 radio', () => {
  it('1. 그룹마다 독립 선택: cellA 클릭 시 onChange({ rad1: cellA })', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={groupedRadioQuestion()}
        value={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('보기A'));
    expect(onChange).toHaveBeenCalledWith({ rad1: 'cellA' });
  });

  it('1b. 기존 선택이 있는 상태에서 다른 그룹 클릭 시 두 그룹 모두 유지', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={groupedRadioQuestion()}
        value={{ rad1: 'cellA' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('보기C'));
    expect(onChange).toHaveBeenCalledWith({ rad1: 'cellA', rad2: 'cellC' });
  });

  it('2. 같은 그룹 내 교체: rad1에서 cellA→cellB', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={groupedRadioQuestion()}
        value={{ rad1: 'cellA' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('보기B'));
    expect(onChange).toHaveBeenCalledWith({ rad1: 'cellB' });
  });

  it('3. 재클릭 해제(토글): cellA 선택 상태에서 cellA 클릭 시 {} (rad1 키 삭제)', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={groupedRadioQuestion()}
        value={{ rad1: 'cellA' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('보기A'));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('4. 미소속 셀(cellD) 클릭 시 default 키에 저장', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={groupedRadioQuestion()}
        value={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('보기D'));
    expect(onChange).toHaveBeenCalledWith({ default: 'cellD' });
  });

  it('5. 선택 상태 표시: value={ rad1: cellA }이면 cellA만 checked', () => {
    render(
      <ChoiceTableResponse
        question={groupedRadioQuestion()}
        value={{ rad1: 'cellA' }}
        onChange={vi.fn()}
      />,
    );
    const inputA = screen.getByLabelText('보기A') as HTMLInputElement;
    const inputB = screen.getByLabelText('보기B') as HTMLInputElement;
    const inputC = screen.getByLabelText('보기C') as HTMLInputElement;
    expect(inputA.checked).toBe(true);
    expect(inputB.checked).toBe(false);
    expect(inputC.checked).toBe(false);
  });
});

describe('비그룹 radio 계약 - 재클릭 해제 불가 유지', () => {
  function plainRadioQuestion(): Question {
    return {
      id: 'qp',
      type: 'radio',
      title: '비그룹 라디오',
      required: true,
      order: 0,
      tableColumns: [{ id: 'col1', label: '보기' }],
      tableRowsData: [
        {
          id: 'row1',
          label: '',
          cells: [
            { id: 'cellA', type: 'choice_opt', content: '', choiceLabel: '보기A' },
            { id: 'cellB', type: 'choice_opt', content: '', choiceLabel: '보기B' },
          ],
        },
      ],
    } as unknown as Question;
  }

  it('선택된 셀을 다시 클릭해도 onChange가 호출되지 않는다', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse question={plainRadioQuestion()} value="cellA" onChange={onChange} />,
    );
    const checkedInput = document.querySelector('input[type="radio"]:checked');
    expect(checkedInput).not.toBeNull();
    fireEvent.click(checkedInput!);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('다른 셀 클릭은 기존대로 교체 선택된다', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse question={plainRadioQuestion()} value="cellA" onChange={onChange} />,
    );
    const inputs = document.querySelectorAll('input[type="radio"]');
    fireEvent.click(inputs[1]!);
    expect(onChange).toHaveBeenCalledWith('cellB');
  });
});
