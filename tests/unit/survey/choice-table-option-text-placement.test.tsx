/**
 * 보기-소스 표(ChoiceTableResponse)의 상세 기재 입력 위치.
 *
 * 데스크톱 표는 열 폭이 좁아(200px 대) 셀 안에 입력칸을 넣으면 우겨넣어진다.
 * 일반 라디오/체크박스가 쓰는 OptionTextInputStack(라벨 칩 + 풀폭 한 줄)을 표 아래에
 * 붙이고, 셀 안에는 넣지 않는다. 모바일 카드·드릴다운은 카드가 풀폭이라 셀 안을 유지한다.
 */
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import type { Question } from '@/types/survey';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => false,
  useMediaQuery: () => false,
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

/** AQ1 축소판 — 두 보기 그룹(2025년 12월 기준 / 현재)에 같은 "기타" 보기가 있다. */
function twoGroupQuestion(): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '상태',
    required: true,
    order: 0,
    choiceGroups: [
      { id: 'grpPast', type: 'radio', label: '2025년 12월 기준', groupKey: 'rad1' },
      { id: 'grpNow', type: 'radio', label: '현재', groupKey: 'rad2' },
    ],
    tableColumns: [
      { id: 'c1', label: '내용' },
      { id: 'c2', label: '2025년 12월 기준' },
      { id: 'c3', label: '현재' },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'r1c1', type: 'text', content: '① 취업' },
          { id: 'r1c2', type: 'choice_opt', content: '', choiceLabel: '취업', choiceGroupId: 'grpPast' },
          { id: 'r1c3', type: 'choice_opt', content: '', choiceLabel: '취업', choiceGroupId: 'grpNow' },
        ],
      },
      {
        id: 'r2',
        label: '',
        cells: [
          { id: 'r2c1', type: 'text', content: '② 기타' },
          {
            id: 'r2c2',
            type: 'choice_opt',
            content: '',
            choiceLabel: '기타',
            choiceGroupId: 'grpPast',
            allowTextInput: true,
            textInputPlaceholder: '상세 기재',
          },
          {
            id: 'r2c3',
            type: 'choice_opt',
            content: '',
            choiceLabel: '기타',
            choiceGroupId: 'grpNow',
            allowTextInput: true,
            textInputPlaceholder: '상세 기재',
          },
        ],
      },
    ],
  } as Question;
}

/** 상세 기재 입력칸이 표 안(td)에 있는지, 표 밖에 있는지. */
function detailInputs() {
  return screen.queryAllByPlaceholderText('상세 기재');
}

describe('보기-소스 표의 상세 기재 배치', () => {
  it('아무것도 고르지 않으면 상세 기재가 없다', () => {
    render(<ChoiceTableResponse question={twoGroupQuestion()} value={{}} onChange={() => {}} />);
    expect(detailInputs()).toHaveLength(0);
  });

  it('데스크톱에서는 라벨 칩이 달린 한 줄 셸(OptionTextRow) 안에 렌더된다', () => {
    render(
      <ChoiceTableResponse
        question={twoGroupQuestion()}
        value={{ rad2: 'r2c3' }}
        onChange={() => {}}
      />,
    );
    const inputs = detailInputs();
    expect(inputs).toHaveLength(1);
    // 셀 안 렌더에는 칩이 없다 — 칩을 품은 label 이 조상이면 스택 경로를 탄 것이다.
    const shell = inputs[0]!.closest('label');
    expect(shell).not.toBeNull();
    expect(shell!.textContent).toContain('현재 · 기타');
  });

  it('보기 그룹이 여럿이면 칩에 그룹 라벨이 붙는다', () => {
    render(
      <ChoiceTableResponse
        question={twoGroupQuestion()}
        value={{ rad2: 'r2c3' }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('현재 · 기타')).toBeInTheDocument();
  });

  it('양쪽 그룹에서 같은 보기를 고르면 칩 두 개가 그룹으로 구분된다', () => {
    render(
      <ChoiceTableResponse
        question={twoGroupQuestion()}
        value={{ rad1: 'r2c2', rad2: 'r2c3' }}
        onChange={() => {}}
      />,
    );
    expect(detailInputs()).toHaveLength(2);
    expect(screen.getByText('2025년 12월 기준 · 기타')).toBeInTheDocument();
    expect(screen.getByText('현재 · 기타')).toBeInTheDocument();
  });
});
