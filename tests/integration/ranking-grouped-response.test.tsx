/**
 * ranking 그룹 응답 통합 테스트 — RankingQuestion 컴포넌트 렌더 기반.
 *
 * 검증 범위:
 *  - 그룹 헤딩 렌더 (라벨 / groupKey 폴백 / default)
 *  - select 조작 → onChange payload (handleGroupChange 배선)
 *  - 두 키 공존 / 키 삭제 동작
 *  - cap 안내문 (그룹 멤버 수 < positions)
 *  - 비그룹 경로 (단일 스택, flat RankingAnswer[] onChange)
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Question, RankingAnswer } from '@/types/survey';
import { RankingQuestion } from '@/components/survey-response/ranking-question';
import type { RankingDropdownStackProps } from '@/components/survey-response/ranking-dropdown-stack';

// 데스크탑 강제 — isMobile=false 로 Radix Select 대신 내부 select 확인 불필요한 분기 제거.
// 하지만 RankingDropdownStack 을 모킹해 native select 로 교체하므로 matchMedia 영향 없음.
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => false,
  useMediaQuery: () => false,
}));

// TablePreview 는 ResizeObserver 를 사용하므로 jsdom 에서 모킹.
vi.mock('@/components/survey-builder/table-preview', () => ({
  TablePreview: () => null,
}));

// MobileOptionCard 도 테스트 범위 밖.
vi.mock('@/components/survey-response/mobile-card-shared', () => ({
  MobileOptionCard: () => null,
}));

/**
 * RankingDropdownStack 을 native <select> 들로 교체한 테스트 더블.
 * - 그룹 헤딩·cap 안내문 렌더는 RankingQuestion 자체가 책임지므로 스택만 교체.
 * - positions 개수만큼 <select> 를 렌더하고, 선택 시 onChange 를 호출.
 * - 각 select 의 aria-label 은 "${rank}순위 선택" — 실제 컴포넌트와 동일 패턴.
 */
vi.mock('@/components/survey-response/ranking-dropdown-stack', () => ({
  RankingDropdownStack: ({
    answers,
    options,
    positions,
    onChange,
  }: RankingDropdownStackProps) => {
    const answerAt = (rank: number) => answers.find((a) => a.rank === rank);

    return (
      <div data-testid="ranking-stack">
        {Array.from({ length: positions }, (_, i) => i + 1).map((rank) => (
          <select
            key={rank}
            aria-label={`${rank}순위 선택`}
            value={answerAt(rank)?.optionValue ?? ''}
            onChange={(e) => {
              const newValue = e.target.value;
              const filtered = answers.filter((a) => a.rank !== rank);
              if (!newValue) {
                onChange(filtered);
                return;
              }
              onChange([...filtered, { rank, optionValue: newValue }]);
            }}
          >
            <option value="">선택하세요...</option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ))}
      </div>
    );
  },
}));

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
    // rnk2 는 label="" — groupKey 'rnk2' 가 헤딩으로 나타나야 한다
    expect(screen.getByText('rnk2')).toBeInTheDocument();
  });

  it('미소속 셀은 default 그룹으로 분류되어 "default" 헤딩이 표시된다', () => {
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={vi.fn()} />,
    );
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('3개 그룹(rnk1, rnk2, default) 각각에 드롭다운 스택이 렌더된다', () => {
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={vi.fn()} />,
    );
    // 각 그룹에 RankingDropdownStack(테스트 더블)이 하나씩 렌더되어야 한다
    const stacks = screen.getAllByTestId('ranking-stack');
    expect(stacks).toHaveLength(3);
  });
});

// ── 선택 → payload ────────────────────────────────────────────────────────────

describe('RankingQuestion — 선택 조작 → onChange payload', () => {
  it('rnk1 영역 1순위 select 에서 cellA 선택 → onChange({ rnk1: [{rank:1, optionValue:"cellA"}] })', () => {
    const onChange = vi.fn();
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={onChange} />,
    );

    // rnk1 그룹 헤딩("그룹 하나")의 부모 컨테이너 안에서 1순위 select 를 찾는다
    const heading = screen.getByText('그룹 하나');
    const container = heading.closest<HTMLElement>('div[class]')!;
    const select = within(container).getByRole('combobox', { name: '1순위 선택' });

    fireEvent.change(select, { target: { value: 'cellA' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0]![0];
    expect(arg).toEqual({ rnk1: [{ rank: 1, optionValue: 'cellA' }] });
  });

  it('rnk1에 이미 선택된 값이 있을 때 rnk2에서 cellC 선택 → 두 키 모두 존재', () => {
    const onChange = vi.fn();
    const initialValue = { rnk1: [{ rank: 1, optionValue: 'cellA' }] };

    render(
      <RankingQuestion
        question={groupedRankingFixture()}
        value={initialValue}
        onChange={onChange}
      />,
    );

    // rnk2 그룹 헤딩("rnk2") 컨테이너 안의 1순위 select
    const heading = screen.getByText('rnk2');
    const container = heading.closest<HTMLElement>('div[class]')!;
    const select = within(container).getByRole('combobox', { name: '1순위 선택' });

    fireEvent.change(select, { target: { value: 'cellC' } });

    const arg = onChange.mock.calls[0]![0];
    expect(arg).toHaveProperty('rnk1');
    expect(arg).toHaveProperty('rnk2');
    expect(arg['rnk1']).toEqual([{ rank: 1, optionValue: 'cellA' }]);
    expect(arg['rnk2']).toEqual([{ rank: 1, optionValue: 'cellC' }]);
  });

  it('선택 해제(빈 값 선택) 시 해당 그룹 키가 payload 에서 제거된다', () => {
    const onChange = vi.fn();
    const initialValue = { rnk1: [{ rank: 1, optionValue: 'cellA' }] };

    render(
      <RankingQuestion
        question={groupedRankingFixture()}
        value={initialValue}
        onChange={onChange}
      />,
    );

    // rnk1 그룹 헤딩("그룹 하나") 컨테이너 안의 1순위 select
    const heading = screen.getByText('그룹 하나');
    const container = heading.closest<HTMLElement>('div[class]')!;
    const select = within(container).getByRole('combobox', { name: '1순위 선택' });

    // 빈 값으로 변경 = 선택 해제
    fireEvent.change(select, { target: { value: '' } });

    const arg = onChange.mock.calls[0]![0];
    // rnk1 키가 없어야 한다
    expect('rnk1' in arg).toBe(false);
  });
});

// ── cap 안내문 ────────────────────────────────────────────────────────────────

describe('RankingQuestion — cap 안내문', () => {
  it('rnk1 멤버 2개 < positions 3 이면 "선택지가 2개라 최대 2순위까지" 문구가 표시된다', () => {
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={vi.fn()} />,
    );
    // "선택지가 2개라 최대 2순위까지 입력할 수 있습니다." 텍스트가 존재해야 한다
    const capTexts = screen.getAllByText(/선택지가 2개라 최대 2순위까지/);
    expect(capTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('rnk1(멤버 2) 영역 select 는 positions=2 개 렌더된다', () => {
    render(
      <RankingQuestion question={groupedRankingFixture()} value={null} onChange={vi.fn()} />,
    );

    const heading = screen.getByText('그룹 하나');
    const container = heading.closest<HTMLElement>('div[class]')!;
    const selects = within(container).getAllByRole('combobox');
    // 멤버 2개이므로 groupPositions=min(3,2)=2 → select 2개
    expect(selects).toHaveLength(2);
  });
});

// ── 비그룹 경로 ────────────────────────────────────────────────────────────────

describe('RankingQuestion — 비그룹 경로 (단일 스택)', () => {
  it('choiceGroups 없는 질문 → 스택 1개, select positions=3 개 렌더된다', () => {
    render(
      <RankingQuestion question={flatRankingFixture()} value={null} onChange={vi.fn()} />,
    );

    // 그룹 헤딩 없어야 한다
    expect(screen.queryByText('그룹 하나')).not.toBeInTheDocument();
    expect(screen.queryByText('rnk2')).not.toBeInTheDocument();
    expect(screen.queryByText('default')).not.toBeInTheDocument();

    // 단일 스택
    const stacks = screen.getAllByTestId('ranking-stack');
    expect(stacks).toHaveLength(1);

    // positions=3 → select 3개
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(3);
  });

  it('비그룹: 1순위 select 에서 cellA 선택 → onChange([{rank:1, optionValue:"cellA"}])', () => {
    const onChange = vi.fn();
    render(
      <RankingQuestion question={flatRankingFixture()} value={null} onChange={onChange} />,
    );

    const select = screen.getByRole('combobox', { name: '1순위 선택' });
    fireEvent.change(select, { target: { value: 'cellA' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0]![0] as RankingAnswer[];
    expect(Array.isArray(arg)).toBe(true);
    expect(arg).toEqual([{ rank: 1, optionValue: 'cellA' }]);
  });
});
