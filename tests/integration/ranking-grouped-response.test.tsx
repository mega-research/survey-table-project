/**
 * ranking 그룹 응답 통합 테스트 — RankingQuestion 컴포넌트 렌더 기반.
 *
 * 검증 범위:
 *  - 그룹 헤딩 렌더 (라벨 / groupKey 폴백 / default)
 *  - 보기(순위 옵션 셀) 클릭 → onChange payload (handleGroupChange 배선)
 *  - 두 키 공존 / 키 삭제(재클릭·순위초기화) 동작
 *  - cap 안내문 + 요약 칩 개수 (그룹 멤버 수 < positions)
 *  - 비그룹 경로 (flat RankingAnswer[] onChange, 순위 다 참 안내)
 *  - inputMode 미지정이면 기존 드롭다운 그대로
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Question, RankingAnswer, TableCell, TableRow } from '@/types/survey';
import { RankingQuestion } from '@/components/survey-response/ranking-question';

// 기본은 데스크탑 — 표 소스는 데스크탑에서 TablePreview renderCell 로 셀을 그린다.
// 모바일 카드 경로 테스트만 플래그를 올린다.
let mobileFlag = false;
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => mobileFlag,
  useMediaQuery: () => mobileFlag,
}));

// TablePreview 는 ResizeObserver 를 쓰므로 jsdom 에서 모킹. renderCell 오버라이드만
// 그대로 호출해 순위 옵션 셀이 클릭 가능한 보기로 나오게 한다.
vi.mock('@/components/survey-builder/table-preview', () => ({
  TablePreview: ({
    rows = [],
    renderCell,
  }: {
    rows?: TableRow[];
    renderCell?: (cell: TableCell, row: TableRow) => React.ReactNode;
  }) => (
    <div data-testid="table-preview">
      {rows.flatMap((row) =>
        row.cells.map((cell) => (
          <div key={cell.id} data-testid={`cell-${cell.id}`}>
            {renderCell?.(cell, row) ?? cell.content}
          </div>
        )),
      )}
    </div>
  ),
}));


afterEach(() => {
  mobileFlag = false;
});

/** 그룹 헤딩이 든 요약 컨테이너(헤딩 + 요약 줄 + 안내문). */
function groupSection(headingText: string): HTMLElement {
  return screen.getByText(headingText).parentElement!;
}

/**
 * 그룹 순위형 질문 픽스처.
 * - rnk1 그룹: 항목A(cellA), 항목B(cellB) — 멤버 2개
 * - rnk2 그룹: 항목C(cellC), 항목D(cellD) — 멤버 2개, 라벨 없음
 * - 미소속(default): 항목E(cellE) — 멤버 1개
 * positions=3, optionsSource='table'
 */
function groupedRankingFixture(): Question {
  return {
    id: 'qr1',
    type: 'ranking',
    title: '순위형 그룹 질문',
    required: false,
    order: 0,
    rankingConfig: {
      optionsSource: 'table',
      positions: 3,
      allowDuplicateRanks: false,
      positionsColumns: undefined,
      inputMode: 'click',
    },
    tableColumns: [{ id: 'c1', label: '열' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          {
            id: 'cellA',
            type: 'ranking_opt',
            content: '항목A',
            rankingLabel: '항목A',
            choiceGroupId: 'grpRnk1',
          },
        ],
      },
      {
        id: 'r2',
        label: '',
        cells: [
          {
            id: 'cellB',
            type: 'ranking_opt',
            content: '항목B',
            rankingLabel: '항목B',
            choiceGroupId: 'grpRnk1',
          },
        ],
      },
      {
        id: 'r3',
        label: '',
        cells: [
          {
            id: 'cellC',
            type: 'ranking_opt',
            content: '항목C',
            rankingLabel: '항목C',
            choiceGroupId: 'grpRnk2',
          },
        ],
      },
      {
        id: 'r4',
        label: '',
        cells: [
          {
            id: 'cellD',
            type: 'ranking_opt',
            content: '항목D',
            rankingLabel: '항목D',
            choiceGroupId: 'grpRnk2',
          },
        ],
      },
      {
        id: 'r5',
        label: '',
        cells: [
          {
            id: 'cellE',
            type: 'ranking_opt',
            content: '항목E',
            rankingLabel: '항목E',
            // choiceGroupId 없음 — default 그룹
          },
        ],
      },
    ],
    choiceGroups: [
      { id: 'grpRnk1', type: 'ranking', groupKey: 'rnk1', label: '그룹 하나' },
      { id: 'grpRnk2', type: 'ranking', groupKey: 'rnk2', label: '' },
    ],
  } as unknown as Question;
}

/**
 * 비그룹 순위형 질문 픽스처.
 * - optionsSource='table', choiceGroups 없음
 * - positions=3, ranking_opt 셀 5개
 */
function flatRankingFixture(): Question {
  return {
    id: 'qflat',
    type: 'ranking',
    title: '비그룹 순위형',
    required: false,
    order: 0,
    rankingConfig: {
      optionsSource: 'table',
      positions: 3,
      allowDuplicateRanks: false,
      positionsColumns: undefined,
      inputMode: 'click',
    },
    tableColumns: [{ id: 'c1', label: '열' }],
    tableRowsData: [
      { id: 'r1', label: '', cells: [{ id: 'cellA', type: 'ranking_opt', content: '항목A', rankingLabel: '항목A' }] },
      { id: 'r2', label: '', cells: [{ id: 'cellB', type: 'ranking_opt', content: '항목B', rankingLabel: '항목B' }] },
      { id: 'r3', label: '', cells: [{ id: 'cellC', type: 'ranking_opt', content: '항목C', rankingLabel: '항목C' }] },
      { id: 'r4', label: '', cells: [{ id: 'cellD', type: 'ranking_opt', content: '항목D', rankingLabel: '항목D' }] },
      { id: 'r5', label: '', cells: [{ id: 'cellE', type: 'ranking_opt', content: '항목E', rankingLabel: '항목E' }] },
    ],
    // choiceGroups 없음 — 비그룹 경로
  } as unknown as Question;
}

// ── 헤딩 렌더 ────────────────────────────────────────────────────────────────

describe('RankingQuestion — 그룹 헤딩 렌더', () => {
  it('label이 있는 그룹은 label 텍스트를 헤딩으로 표시한다', () => {
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={vi.fn()} />,
    );
    expect(screen.getByText('그룹 하나')).toBeInTheDocument();
  });

  it('label이 빈 그룹은 groupKey를 헤딩으로 표시한다', () => {
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={vi.fn()} />,
    );
    expect(screen.getByText('rnk2')).toBeInTheDocument();
  });

  it('미소속 셀은 default 그룹으로 분류되어 "default" 헤딩이 표시된다', () => {
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={vi.fn()} />,
    );
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('3개 그룹(rnk1, rnk2, default) 각각에 요약 줄(순위초기화 버튼)이 렌더되고 표는 하나다', () => {
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={vi.fn()} />,
    );
    expect(screen.getAllByRole('button', { name: '순위초기화' })).toHaveLength(3);
    expect(screen.getAllByTestId('table-preview')).toHaveLength(1);
  });
});

// ── 선택 → payload ────────────────────────────────────────────────────────────

describe('RankingQuestion — 보기 클릭 → onChange payload', () => {
  it('항목A(rnk1) 클릭 → onChange({ rnk1: [{rank:1, optionValue:"cellA"}] })', () => {
    const onChange = vi.fn();
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '항목A' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toEqual({ rnk1: [{ rank: 1, optionValue: 'cellA' }] });
  });

  it('rnk1에 이미 선택된 값이 있을 때 항목C(rnk2) 클릭 → 두 키 모두 존재', () => {
    const onChange = vi.fn();
    const initialValue = { rnk1: [{ rank: 1, optionValue: 'cellA' }] };

    render(
      <RankingQuestion
        question={groupedRankingFixture()}
        value={initialValue}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '항목C' }));

    const arg = onChange.mock.calls[0]![0];
    expect(arg['rnk1']).toEqual([{ rank: 1, optionValue: 'cellA' }]);
    expect(arg['rnk2']).toEqual([{ rank: 1, optionValue: 'cellC' }]);
  });

  it('순위가 있는 보기를 다시 클릭하면 해제되고, 그룹이 비면 키가 payload 에서 빠진다', () => {
    const onChange = vi.fn();
    const initialValue = { rnk1: [{ rank: 1, optionValue: 'cellA' }] };

    render(
      <RankingQuestion
        question={groupedRankingFixture()}
        value={initialValue}
        onChange={onChange}
      />,
    );

    const cellA = screen.getByRole('button', { name: '항목A' });
    expect(cellA).toHaveAttribute('aria-pressed', 'true');
    expect(within(cellA).getByText('1순위')).toBeInTheDocument();

    fireEvent.click(cellA);

    expect('rnk1' in onChange.mock.calls[0]![0]).toBe(false);
  });

  it('그룹의 순위초기화는 그 그룹 키만 비운다', () => {
    const onChange = vi.fn();
    const initialValue = {
      rnk1: [{ rank: 1, optionValue: 'cellA' }],
      rnk2: [{ rank: 1, optionValue: 'cellC' }],
    };

    render(
      <RankingQuestion
        question={groupedRankingFixture()}
        value={initialValue}
        onChange={onChange}
      />,
    );

    fireEvent.click(within(groupSection('그룹 하나')).getByRole('button', { name: '순위초기화' }));

    expect(onChange.mock.calls[0]![0]).toEqual({ rnk2: [{ rank: 1, optionValue: 'cellC' }] });
  });
});

// ── cap 안내문 ────────────────────────────────────────────────────────────────

describe('RankingQuestion — cap 안내문', () => {
  it('rnk1 멤버 2개 < positions 3 이면 "선택지가 2개라 최대 2순위까지" 문구가 표시된다', () => {
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={vi.fn()} />,
    );
    const capTexts = screen.getAllByText(/선택지가 2개라 최대 2순위까지/);
    expect(capTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('rnk1(멤버 2) 요약 줄에는 순위 칩이 2개다', () => {
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={vi.fn()} />,
    );
    const chips = within(groupSection('그룹 하나')).getAllByLabelText(/순위 선택$/);
    expect(chips).toHaveLength(2);
  });
});

// ── 비그룹 경로 ────────────────────────────────────────────────────────────────

describe('RankingQuestion — 비그룹 경로', () => {
  it('choiceGroups 없는 질문 → 요약 줄 1개, 순위 칩 positions=3 개', () => {
    render(
      <RankingQuestion question={flatRankingFixture()} value={null} onChange={vi.fn()} />,
    );

    expect(screen.queryByText('그룹 하나')).not.toBeInTheDocument();
    expect(screen.queryByText('rnk2')).not.toBeInTheDocument();
    expect(screen.queryByText('default')).not.toBeInTheDocument();

    expect(screen.getAllByRole('button', { name: '순위초기화' })).toHaveLength(1);
    expect(screen.getAllByLabelText(/순위 선택$/)).toHaveLength(3);
  });

  it('비그룹: 항목A 클릭 → onChange([{rank:1, optionValue:"cellA"}])', () => {
    const onChange = vi.fn();
    render(
      <RankingQuestion question={flatRankingFixture()} value={null} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '항목A' }));

    const arg = onChange.mock.calls[0]![0] as RankingAnswer[];
    expect(arg).toEqual([{ rank: 1, optionValue: 'cellA' }]);
  });

  it('요약 칩은 선택한 보기의 순번을 보여준다', () => {
    render(
      <RankingQuestion
        question={flatRankingFixture()}
        value={[
          { rank: 1, optionValue: 'cellC' },
          { rank: 2, optionValue: 'cellA' },
        ]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('1순위 선택')).toHaveTextContent('3');
    expect(screen.getByLabelText('2순위 선택')).toHaveTextContent('1');
    expect(screen.getByLabelText('3순위 선택')).toHaveTextContent('-');
  });

  it('순위가 다 찼는데 다른 보기를 누르면 바꾸지 않고 안내를 띄운다', () => {
    const onChange = vi.fn();
    render(
      <RankingQuestion
        question={flatRankingFixture()}
        value={[
          { rank: 1, optionValue: 'cellA' },
          { rank: 2, optionValue: 'cellB' },
          { rank: 3, optionValue: 'cellC' },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '항목D' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('3순위까지 모두 선택했습니다');
  });
});

// ── 회귀: 열 정의 없는 그룹 표 소스 ───────────────────────────────────────

describe('RankingQuestion — 열 정의가 없는 표 소스', () => {
  it('그룹 순위형에 tableColumns 가 없어도 그룹 맵 모양으로 onChange 한다', () => {
    const onChange = vi.fn();
    const question = { ...groupedRankingFixture(), tableColumns: [] } as unknown as Question;
    render(
      <RankingQuestion
        question={question}
        value={{ rnk2: [{ rank: 1, optionValue: 'cellC' }] }}
        onChange={onChange}
      />,
    );

    expect(screen.queryByTestId('table-preview')).not.toBeInTheDocument();
    expect(screen.getByText('그룹 하나')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '항목A' }));

    expect(onChange.mock.calls[0]![0]).toEqual({
      rnk1: [{ rank: 1, optionValue: 'cellA' }],
      rnk2: [{ rank: 1, optionValue: 'cellC' }],
    });
  });

  it('비그룹 표 소스도 열 정의가 없으면 목록으로 그리고 flat 배열로 onChange 한다', () => {
    const onChange = vi.fn();
    const question = { ...flatRankingFixture(), tableColumns: undefined } as unknown as Question;
    render(<RankingQuestion question={question} value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '항목B' }));
    expect(onChange).toHaveBeenCalledWith([{ rank: 1, optionValue: 'cellB' }]);
  });
});

// ── 회귀: 모바일 카드 ──────────────────────────────────────────────────────

describe('RankingQuestion — 모바일 카드', () => {
  /** 한 행에 순위 옵션 셀이 둘인 비그룹 표 소스. */
  function twoOptsPerRowFixture(): Question {
    return {
      ...flatRankingFixture(),
      tableRowsData: [
        {
          id: 'r1',
          label: '',
          cells: [
            { id: 'cellA', type: 'ranking_opt', content: '항목A', rankingLabel: '항목A' },
            { id: 'cellB', type: 'ranking_opt', content: '항목B', rankingLabel: '항목B' },
          ],
        },
        {
          id: 'r2',
          label: '',
          cells: [{ id: 'cellC', type: 'ranking_opt', content: '항목C', rankingLabel: '항목C' }],
        },
      ],
    } as unknown as Question;
  }

  it('한 행의 순위 옵션 셀마다 카드가 하나씩 나온다', () => {
    mobileFlag = true;
    render(<RankingQuestion question={twoOptsPerRowFixture()} value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '항목A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '항목B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '항목C' })).toBeInTheDocument();
  });

  it('배지 버튼을 누르면 순위가 매겨지고 aria-pressed 로 상태를 알린다', () => {
    mobileFlag = true;
    const onChange = vi.fn();
    render(
      <RankingQuestion
        question={twoOptsPerRowFixture()}
        value={[{ rank: 1, optionValue: 'cellC' }]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('button', { name: '항목C' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '항목B' }));
    expect(onChange).toHaveBeenCalledWith([
      { rank: 1, optionValue: 'cellC' },
      { rank: 2, optionValue: 'cellB' },
    ]);
  });
});

// ── 기본 입력 방식은 드롭다운 ───────────────────────────────────────────────

describe('RankingQuestion — inputMode 기본값', () => {
  it('inputMode 가 없으면 기존처럼 순위마다 드롭다운을 그리고 클릭 UI 는 없다', () => {
    const question = flatRankingFixture();
    const { inputMode: _omit, ...rest } = question.rankingConfig!;
    question.rankingConfig = rest;
    render(<RankingQuestion question={question} value={null} onChange={vi.fn()} />);

    expect(screen.getAllByRole('combobox', { name: /순위 선택$/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '순위초기화' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '항목A' })).not.toBeInTheDocument();
  });

  it('inputMode=click 이어도 중복 순위 허용이면 드롭다운이다', () => {
    const question = flatRankingFixture();
    question.rankingConfig = { ...question.rankingConfig!, allowDuplicateRanks: true };
    render(<RankingQuestion question={question} value={null} onChange={vi.fn()} />);

    expect(screen.getAllByRole('combobox', { name: /순위 선택$/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '순위초기화' })).not.toBeInTheDocument();
  });
});
