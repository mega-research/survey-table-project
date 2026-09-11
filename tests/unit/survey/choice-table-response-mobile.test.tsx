import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question } from '@/types/survey';

// 모바일 뷰 강제
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));

function question(): Question {
  return {
    id: 'q1',
    type: 'checkbox',
    title: '보유 기술',
    required: false,
    order: 0,
    mobileTableDisplayMode: 'auto',
    tableColumns: [
      { id: 'c0', label: '기술', width: 100 },
      { id: 'c1', label: '정의', width: 200 },
      { id: 'c2', label: '선택', width: 60 },
    ],
    tableRowsData: [
      {
        id: 'r1',
        cells: [
          { id: 'r1c0', type: 'text', content: '① 컴퓨터 비전', mobileDisplay: 'hidden' },
          { id: 'r1c1', type: 'text', content: '이미지 정보 추출', mobileDisplay: 'collapsed' },
          { id: 'r1c2', type: 'choice_opt', content: '', choiceLabel: '① 컴퓨터 비전' },
        ],
      },
      {
        id: 'r2',
        cells: [
          { id: 'r2c0', type: 'text', content: '② 음성 처리', mobileDisplay: 'hidden' },
          { id: 'r2c1', type: 'text', content: '음성 분석', mobileDisplay: 'collapsed' },
          { id: 'r2c2', type: 'choice_opt', content: '', choiceLabel: '② 음성 처리' },
        ],
      },
    ],
  } as unknown as Question;
}

describe('ChoiceTableResponse (mobile)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('옵션 라벨을 카드로 렌더하고 체크 시 onChange 로 cell.id 전달', () => {
    const onChange = vi.fn();
    render(<ChoiceTableResponse question={question()} value={[]} onChange={onChange} />);
    expect(screen.getByText('① 컴퓨터 비전')).toBeInTheDocument();
    expect(screen.getByText('② 음성 처리')).toBeInTheDocument();
    // 표시 셀 정의는 "자세히" 안에 있어 처음엔 안 보임
    expect(screen.queryByText('이미지 정보 추출')).not.toBeInTheDocument();
    const labelEl = screen.getAllByLabelText(/① 컴퓨터 비전|선택/)[0];
    if (!labelEl) throw new Error('매칭 라벨 엘리먼트가 없음');
    fireEvent.click(labelEl);
    expect(onChange).toHaveBeenCalledWith(['r1c2']);
  });

  it('한 행에 choice_opt 셀이 여러 개일 때 모든 셀이 카드로 렌더되고 선택 가능', () => {
    // 회귀 테스트: 한 행에 choice_opt 가 2개인 경우 두 번째 셀도 카드로 렌더해야 한다
    const multiCellQuestion: Question = {
      id: 'q2',
      type: 'checkbox',
      title: '다중 선택 테스트',
      required: false,
      order: 0,
      tableColumns: [
        { id: 'c0', label: '항목', width: 100 },
        { id: 'c1', label: 'A', width: 60 },
        { id: 'c2', label: 'B', width: 60 },
      ],
      tableRowsData: [
        {
          id: 'r1',
          cells: [
            { id: 'r1c0', type: 'text', content: '항목', mobileDisplay: 'hidden' },
            { id: 'r1cA', type: 'choice_opt', content: '', choiceLabel: 'A' },
            { id: 'r1cB', type: 'choice_opt', content: '', choiceLabel: 'B' },
          ],
        },
      ],
    } as unknown as Question;

    const onChange = vi.fn();
    render(<ChoiceTableResponse question={multiCellQuestion} value={[]} onChange={onChange} />);

    // 두 choice_opt 셀이 모두 카드로 렌더되어야 한다
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();

    // 두 번째 셀(r1cB) 컨트롤 클릭 시 onChange(['r1cB']) 호출
    fireEvent.click(screen.getByLabelText('B'));
    expect(onChange).toHaveBeenCalledWith(['r1cB']);
  });

  it("'header' 로 지정한 text 셀의 내용을 카드 제목으로 사용한다", () => {
    // 옵션명이 별도 text 셀에 있고 choice_opt 는 비어있는 패턴: 저작자가 그 셀을 'header' 로 지정
    const headerQuestion: Question = {
      id: 'q3',
      type: 'checkbox',
      title: '보유 기술',
      required: false,
      order: 0,
      tableColumns: [
        { id: 'c0', label: '기술', width: 100 },
        { id: 'c1', label: '선택', width: 60 },
      ],
      tableRowsData: [
        {
          id: 'r1',
          cells: [
            { id: 'r1c0', type: 'text', content: '① 컴퓨터 비전', mobileDisplay: 'header' },
            { id: 'r1c1', type: 'choice_opt', content: '', exportLabel: '쓰이면 안 되는_엑셀라벨' },
          ],
        },
      ],
    } as unknown as Question;

    render(<ChoiceTableResponse question={headerQuestion} value={[]} onChange={vi.fn()} />);
    // 제목은 header 셀 내용. exportLabel 은 제목으로 쓰이지 않는다.
    expect(screen.getByText('① 컴퓨터 비전')).toBeInTheDocument();
    expect(screen.queryByText('쓰이면 안 되는_엑셀라벨')).not.toBeInTheDocument();
    expect(screen.queryByText('(라벨 없음)')).not.toBeInTheDocument();
  });

  it('choice_opt 스타일은 모바일 라벨 Bold만 적용하고 카드 배경은 유지한다', () => {
    const styledQuestion = question();
    const styledCell = styledQuestion.tableRowsData?.[0]?.cells[2];
    if (!styledCell) throw new Error('스타일 대상 choice_opt 셀이 없습니다');
    styledCell.textBold = true;
    styledCell.backgroundColor = '#AABBCC';

    render(<ChoiceTableResponse question={styledQuestion} value={[]} onChange={vi.fn()} />);

    const label = screen.getByText('① 컴퓨터 비전');
    expect(label).toHaveClass('font-bold');
    const card = label.closest('.bg-white');
    expect(card).toHaveClass('bg-white');
    expect(card).not.toHaveStyle({ backgroundColor: '#AABBCC' });
  });

  it('header 셀에서 온 카드 라벨은 header 셀의 Bold를 따른다', () => {
    const headerQuestion = question();
    const headerCell = headerQuestion.tableRowsData?.[0]?.cells[0];
    const choiceCell = headerQuestion.tableRowsData?.[0]?.cells[2];
    if (!headerCell || !choiceCell) throw new Error('스타일 대상 셀이 없습니다');
    headerCell.mobileDisplay = 'header';
    headerCell.textBold = true;
    choiceCell.textBold = false;

    render(<ChoiceTableResponse question={headerQuestion} value={[]} onChange={vi.fn()} />);

    expect(screen.getByText('① 컴퓨터 비전')).toHaveClass('font-bold');
  });

  it('unstyled header 셀에서 온 카드 라벨은 choice_opt Bold를 받지 않는다', () => {
    const headerQuestion = question();
    const headerCell = headerQuestion.tableRowsData?.[0]?.cells[0];
    const choiceCell = headerQuestion.tableRowsData?.[0]?.cells[2];
    if (!headerCell || !choiceCell) throw new Error('스타일 대상 셀이 없습니다');
    headerCell.mobileDisplay = 'header';
    choiceCell.textBold = true;

    render(<ChoiceTableResponse question={headerQuestion} value={[]} onChange={vi.fn()} />);

    expect(screen.getByText('① 컴퓨터 비전')).not.toHaveClass('font-bold');
  });
});

describe('ChoiceTableResponse (mobile) — 행 단위 카드의 보기 상세기재 자리', () => {
  function rowCardQuestion(): Question {
    const q = question();
    q.mobileTableDisplayMode = 'row-cards';
    // ① 컴퓨터 비전 보기에 상세기재 허용
    q.tableRowsData![0]!.cells[2] = {
      ...q.tableRowsData![0]!.cells[2]!,
      allowTextInput: true,
      textInputPlaceholder: '비전 상세',
    };
    return q;
  }

  it('선택한 보기의 상세기재는 카드 안이 아니라 그 카드 바로 아래에 나온다', () => {
    const { container } = render(
      <ChoiceTableResponse question={rowCardQuestion()} value={['r1c2']} onChange={() => {}} />,
    );
    const input = screen.getByPlaceholderText('비전 상세');
    // 카드(rounded-2xl) 안에 있지 않다
    expect(input.closest('.rounded-2xl')).toBeNull();
    // 첫 카드 뒤, 둘째 카드 앞 — 어느 카드 것인지 바로 보인다
    const cards = container.querySelectorAll('.rounded-2xl');
    expect(cards.length).toBe(2);
    expect(cards[0]!.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input.compareDocumentPosition(cards[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('카드 아래 입력 줄의 라벨 칩은 잘리지 않고 입력칸 위에 줄바꿈으로 놓인다', () => {
    render(
      <ChoiceTableResponse question={rowCardQuestion()} value={['r1c2']} onChange={() => {}} />,
    );
    const shell = screen.getByPlaceholderText('비전 상세').closest('label')!;
    expect(shell).toHaveClass('flex-col');
    const chip = shell.querySelector('span')!;
    expect(chip).toHaveClass('whitespace-normal');
    expect(chip).not.toHaveClass('truncate');
  });

  it('셀 단위 카드(auto)에서는 여전히 카드 안에 나온다', () => {
    const q = rowCardQuestion();
    q.mobileTableDisplayMode = 'auto';
    render(<ChoiceTableResponse question={q} value={['r1c2']} onChange={() => {}} />);
    expect(screen.getByPlaceholderText('비전 상세').closest('.rounded-2xl')).not.toBeNull();
  });
});

describe('ChoiceTableResponse (mobile) — 행 단위 카드의 게이팅 셀', () => {
  function gatedQuestion(): Question {
    const q = question();
    q.mobileTableDisplayMode = 'row-cards';
    // ① 컴퓨터 비전 카드에 "선택하면 열리는" 입력 셀
    q.tableRowsData![0]!.cells.push({
      id: 'r1in',
      type: 'input',
      content: '',
      placeholder: '비전 상세',
      enabledWhen: { kind: 'choice-selected', controllerCellId: 'r1c2' },
    });
    return q;
  }

  it('미충족이면 입력칸도 "-" 도 없다', () => {
    render(<ChoiceTableResponse question={gatedQuestion()} value={[]} onChange={() => {}} />);
    expect(screen.queryByPlaceholderText('비전 상세')).toBeNull();
    expect(screen.queryByText('-')).toBeNull();
  });

  it('보기를 고르면 입력칸이 카드 안에 나온다', () => {
    render(<ChoiceTableResponse question={gatedQuestion()} value={['r1c2']} onChange={() => {}} />);
    expect(screen.getByPlaceholderText('비전 상세').closest('.rounded-2xl')).not.toBeNull();
  });
});

describe('ChoiceTableResponse (mobile) — 행 단위 그룹 카드', () => {
  /** B1 축소판: 행마다 인지 여부(2)·필요성(3)·참여 의향(2) 라디오 그룹, 구분 셀은 제목+설명 */
  function groupedRowQuestion(): Question {
    return {
      id: 'q1',
      type: 'radio',
      title: 'B1',
      required: false,
      order: 0,
      mobileTableDisplayMode: 'row-group-cards',
      choiceGroups: [
        { id: 'g1', type: 'radio', groupKey: 'rad01', label: '1) 얼라이언스 운영 - 인지여부' },
        { id: 'g2', type: 'radio', groupKey: 'rad02', label: '1) 얼라이언스 운영 - 필요성' },
        { id: 'g3', type: 'radio', groupKey: 'rad03', label: '1) 얼라이언스 운영 - 참여 의향' },
      ],
      tableColumns: [
        { id: 'c0', label: '구분' },
        { id: 'c1', label: '알고있음' },
        { id: 'c2', label: '모름' },
        { id: 'c3', label: '필요 없음' },
        { id: 'c4', label: '보통' },
        { id: 'c5', label: '필요함' },
        { id: 'c6', label: '있음' },
        { id: 'c7', label: '없음' },
      ],
      tableRowsData: [
        {
          id: 'r1',
          cells: [
            { id: 'r1c0', type: 'text', content: '1) 얼라이언스 운영\n네트워킹 및 행사 개최', boldFirstLine: true },
            { id: 'r1c1', type: 'choice_opt', content: '', choiceLabel: '알고 있음', choiceGroupId: 'g1' },
            { id: 'r1c2', type: 'choice_opt', content: '', choiceLabel: '모름', choiceGroupId: 'g1' },
            { id: 'r1c3', type: 'choice_opt', content: '', choiceLabel: '필요 없음', choiceGroupId: 'g2' },
            { id: 'r1c4', type: 'choice_opt', content: '', choiceLabel: '보통', choiceGroupId: 'g2' },
            { id: 'r1c5', type: 'choice_opt', content: '', choiceLabel: '필요함', choiceGroupId: 'g2' },
            { id: 'r1c6', type: 'choice_opt', content: '', choiceLabel: '있음', choiceGroupId: 'g3' },
            { id: 'r1c7', type: 'choice_opt', content: '', choiceLabel: '없음', choiceGroupId: 'g3' },
          ],
        },
      ],
    } as unknown as Question;
  }

  it('행마다 카드 하나 — 구분 셀이 제목·설명으로 보이고 그룹마다 섹션 제목(축 이름)이 붙는다', () => {
    const { container } = render(
      <ChoiceTableResponse question={groupedRowQuestion()} value={{}} onChange={() => {}} />,
    );
    expect(container.querySelectorAll('.rounded-2xl')).toHaveLength(1);
    expect(screen.getByText('1) 얼라이언스 운영')).toBeInTheDocument();
    expect(screen.getByText(/네트워킹 및 행사 개최/)).toBeInTheDocument();
    for (const section of ['인지여부', '필요성', '참여 의향']) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }
  });

  it('구분 셀의 모바일 표시가 켜져 있어도 제목으로 한 번만 나온다', () => {
    const q = groupedRowQuestion();
    q.tableRowsData![0]!.cells[0] = { ...q.tableRowsData![0]!.cells[0]!, mobileDisplay: 'inline' };
    render(<ChoiceTableResponse question={q} value={{}} onChange={() => {}} />);
    expect(screen.getAllByText('1) 얼라이언스 운영')).toHaveLength(1);
    expect(screen.getAllByText(/네트워킹 및 행사 개최/)).toHaveLength(1);
  });

  it('다음을 누른 뒤 미충족 필수 그룹의 섹션만 붉게 두른다', () => {
    const q = groupedRowQuestion();
    q.required = true;
    render(
      <ChoiceTableResponse
        question={q}
        value={{ rad01: 'r1c1' }}
        onChange={() => {}}
        showRequiredHighlight
      />,
    );
    expect(screen.getByTestId('choice-group-section-g1')).not.toHaveClass('border-red-300');
    expect(screen.getByTestId('choice-group-section-g2')).toHaveClass('border-red-300');
    expect(screen.getByTestId('choice-group-section-g3')).toHaveClass('border-red-300');
  });

  it('다음을 누르기 전에는 미충족이어도 붉게 두르지 않는다', () => {
    const q = groupedRowQuestion();
    q.required = true;
    render(<ChoiceTableResponse question={q} value={{}} onChange={() => {}} />);
    expect(screen.getByTestId('choice-group-section-g2')).not.toHaveClass('border-red-300');
  });

  it('타일 라벨은 그룹 라벨이 아니라 보기 텍스트다', () => {
    render(<ChoiceTableResponse question={groupedRowQuestion()} value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText('알고 있음')).toBeInTheDocument();
    expect(screen.getByLabelText('보통')).toBeInTheDocument();
    expect(screen.queryByText('1) 얼라이언스 운영 - 인지여부')).toBeNull();
  });

  it('섹션 안에서 하나를 고르면 그 그룹 키로 onChange 한다', () => {
    const onChange = vi.fn();
    render(<ChoiceTableResponse question={groupedRowQuestion()} value={{}} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('보통'));
    expect(onChange).toHaveBeenCalledWith({ rad02: 'r1c4' });
  });
});

describe('ChoiceTableResponse (mobile) — 게이팅 해제 시 남은 값 정리', () => {
  function gatedQuestion(): Question {
    const q = question();
    q.mobileTableDisplayMode = 'row-cards';
    q.tableRowsData![0]!.cells.push({
      id: 'r1in',
      type: 'input',
      content: '',
      placeholder: '비전 상세',
      enabledWhen: { kind: 'choice-selected', controllerCellId: 'r1c2' },
    });
    return q;
  }

  it('보기를 해제하면 카드에 셀이 없어도 사이드카 값이 지워진다 — 재선택에 이전 값이 되살아나지 않는다', () => {
    useSurveyResponseStore.setState({ optionTexts: { q1: { r1in: '적은 내용' } } });
    render(<ChoiceTableResponse question={gatedQuestion()} value={[]} onChange={() => {}} />);
    expect(useSurveyResponseStore.getState().optionTexts['q1']?.['r1in'] ?? '').toBe('');
  });
});
