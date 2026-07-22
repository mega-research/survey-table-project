import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
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
});
