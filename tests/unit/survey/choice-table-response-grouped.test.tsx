/**
 * 그룹별 선택 radio/checkbox (choiceGroups) 렌더 동작 테스트
 *
 * 픽스처(radio): rad1(cellA, cellB), rad2(cellC), 미소속(cellD)
 * 픽스처(checkbox): cb1(cellE, cellF) 추가 — checkbox 그룹 복수 선택 케이스
 * Step 3 — checkbox 그룹 구현 완료 후 전체 통과
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import type { Question } from '@/types/survey';

// 모바일 강제 — TablePreview(ResizeObserver 의존) 우회
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
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
      <ChoiceTableResponse question={groupedRadioQuestion()} value={null} onChange={onChange} />,
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
      <ChoiceTableResponse question={groupedRadioQuestion()} value={null} onChange={onChange} />,
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

/**
 * radio 질문에 checkbox 그룹(cb1)과 radio 그룹(rad1)이 혼재하는 픽스처.
 * - rad1: cellA, cellB (radio)
 * - cb1: cellE, cellF (checkbox)
 * - 미소속(default): cellD  → 질문 type=radio 이므로 default=radio
 */
function mixedGroupQuestion(): Question {
  return {
    id: 'qmix',
    type: 'radio',
    title: '혼합 그룹',
    required: true,
    order: 0,
    tableColumns: [{ id: 'col1', label: '열1' }],
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
            id: 'cellE',
            type: 'choice_opt',
            content: '',
            choiceLabel: '보기E',
            choiceGroupId: 'grpCb',
          },
          {
            id: 'cellF',
            type: 'choice_opt',
            content: '',
            choiceLabel: '보기F',
            choiceGroupId: 'grpCb',
          },
          { id: 'cellD', type: 'choice_opt', content: '', choiceLabel: '보기D' },
        ],
      },
    ],
    choiceGroups: [
      { id: 'grp1', type: 'radio', groupKey: 'rad1', label: 'Radio그룹' },
      { id: 'grpCb', type: 'checkbox', groupKey: 'cb1', label: 'CB그룹' },
    ],
  } as unknown as Question;
}

/**
 * checkbox 질문에 checkbox 그룹(cb1)이 있는 픽스처.
 * 미소속 셀도 default=checkbox 동작 검증.
 */
function checkboxGroupQuestion(): Question {
  return {
    id: 'qcb',
    type: 'checkbox',
    title: 'Checkbox 질문',
    required: true,
    order: 0,
    tableColumns: [{ id: 'col1', label: '열1' }],
    tableRowsData: [
      {
        id: 'row1',
        label: '',
        cells: [
          {
            id: 'cellE',
            type: 'choice_opt',
            content: '',
            choiceLabel: '보기E',
            choiceGroupId: 'grpCb',
          },
          {
            id: 'cellF',
            type: 'choice_opt',
            content: '',
            choiceLabel: '보기F',
            choiceGroupId: 'grpCb',
          },
          { id: 'cellD', type: 'choice_opt', content: '', choiceLabel: '보기D' },
        ],
      },
    ],
    choiceGroups: [{ id: 'grpCb', type: 'checkbox', groupKey: 'cb1', label: 'CB그룹' }],
  } as unknown as Question;
}

describe('ChoiceTableResponse — checkbox 그룹 복수 선택', () => {
  it('cb1 셀 하나(cellE) 선택 → { cb1: [cellE] }', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse question={mixedGroupQuestion()} value={null} onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText('보기E'));
    expect(onChange).toHaveBeenCalledWith({ cb1: ['cellE'] });
  });

  it('cellE 선택 후 cellF 추가 → { cb1: [cellE, cellF] }', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={mixedGroupQuestion()}
        value={{ cb1: ['cellE'] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('보기F'));
    expect(onChange).toHaveBeenCalledWith({ cb1: ['cellE', 'cellF'] });
  });

  it('cellE, cellF 선택 상태에서 cellE 해제 → { cb1: [cellF] }', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={mixedGroupQuestion()}
        value={{ cb1: ['cellE', 'cellF'] }}
        onChange={onChange}
      />,
    );
    // 체크된 cellE 클릭 → 해제
    fireEvent.click(screen.getByLabelText('보기E'));
    expect(onChange).toHaveBeenCalledWith({ cb1: ['cellF'] });
  });

  it('마지막 셀도 해제하면 cb1 키가 삭제됨 → {}', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={mixedGroupQuestion()}
        value={{ cb1: ['cellE'] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('보기E'));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('rad1 선택과 cb1 복수 선택이 한 맵에 공존: { rad1: cellA, cb1: [cellE] }', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={mixedGroupQuestion()}
        value={{ rad1: 'cellA' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('보기E'));
    expect(onChange).toHaveBeenCalledWith({ rad1: 'cellA', cb1: ['cellE'] });
  });

  it('checkbox 그룹 선택 상태 표시: value={ cb1: [cellE] }이면 cellE만 checked', () => {
    render(
      <ChoiceTableResponse
        question={mixedGroupQuestion()}
        value={{ cb1: ['cellE'] }}
        onChange={vi.fn()}
      />,
    );
    const inputE = screen.getByLabelText('보기E') as HTMLInputElement;
    const inputF = screen.getByLabelText('보기F') as HTMLInputElement;
    expect(inputE.checked).toBe(true);
    expect(inputF.checked).toBe(false);
  });
});

describe('ChoiceTableResponse — checkbox 질문 + checkbox 그룹', () => {
  it('checkbox 질문의 그룹 셀도 배열 응답 동작', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse question={checkboxGroupQuestion()} value={null} onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText('보기E'));
    expect(onChange).toHaveBeenCalledWith({ cb1: ['cellE'] });
  });

  it('checkbox 질문의 미소속 셀(default=checkbox): 클릭 → { default: [cellD] }', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse question={checkboxGroupQuestion()} value={null} onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText('보기D'));
    expect(onChange).toHaveBeenCalledWith({ default: ['cellD'] });
  });
});

function drilldownQuestion(question: Question): Question {
  const rows = question.tableRowsData ?? [];
  const cellCount = rows[0]?.cells.length ?? 0;
  return {
    ...question,
    mobileTableDisplayMode: 'drilldown-original-row',
    mobileDrilldownOmitLeadingColumns: 0,
    tableColumns: Array.from(
      { length: cellCount },
      (_, index) =>
        question.tableColumns?.[index] ?? { id: `col${index + 1}`, label: `열${index + 1}` },
    ),
    tableRowsData: rows.map((row) => ({
      ...row,
      label: '그룹 선택',
    })),
  };
}

describe('ChoiceTableResponse — 원본 행 드릴다운 그룹 응답 shape', () => {
  it('radio 그룹은 상세 control에서 기존 string map shape를 유지한다', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={drilldownQuestion(groupedRadioQuestion())}
        value={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /그룹 선택/ }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('보기A'));
    expect(onChange).toHaveBeenCalledWith({ rad1: 'cellA' });
  });

  it('checkbox 그룹은 상세 control에서 기존 string array map shape를 유지한다', () => {
    const onChange = vi.fn();
    render(
      <ChoiceTableResponse
        question={drilldownQuestion(checkboxGroupQuestion())}
        value={{ cb1: ['cellE'] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /그룹 선택/ }));
    fireEvent.click(screen.getByLabelText('보기F'));
    expect(onChange).toHaveBeenCalledWith({ cb1: ['cellE', 'cellF'] });
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

describe('ChoiceTableResponse — controlled input 경고', () => {
  it('그룹 radio 셀 렌더 시 checked-without-onChange 경고를 내지 않는다', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ChoiceTableResponse question={groupedRadioQuestion()} value={null} onChange={() => {}} />,
    );
    const warned = errorSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('checked')),
    );
    errorSpy.mockRestore();
    expect(warned).toBe(false);
  });
});
