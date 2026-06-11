import { describe, expect, it } from 'vitest';

import {
  collectRankingGroups,
  isGroupedRankingQuestion,
  type GroupedRankingAnswer,
} from '@/utils/choice-group-helpers';
import { parseRankingAnswers } from '@/utils/ranking-shared';
import { resolveRankingOptionsFromCells } from '@/utils/ranking-source';
import type { Question, RankingAnswer } from '@/types/survey';

/**
 * 순위형(positions 3) + optionsSource='table' 픽스처.
 * - rnk1 그룹: cellA, cellB (멤버 2)
 * - rnk2 그룹: cellC, cellD (멤버 2)
 * - 미소속: cellE (default 그룹으로 분류)
 */
function groupedRankingQ(): Question {
  return {
    id: 'qr1',
    type: 'radio',
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
            // choiceGroupId 없음 — default 그룹 소속
          },
        ],
      },
    ],
    choiceGroups: [
      { id: 'grpRnk1', type: 'ranking', groupKey: 'rnk1', label: '그룹1' },
      { id: 'grpRnk2', type: 'ranking', groupKey: 'rnk2', label: '그룹2' },
    ],
  } as unknown as Question;
}

/** 수동 소스 순위형 질문 (비그룹 경로 보장용). */
function flatRankingQ(): Question {
  return {
    id: 'qflat',
    type: 'radio',
    title: '일반 순위형',
    required: false,
    order: 0,
    rankingConfig: {
      optionsSource: 'manual',
      positions: 3,
      allowDuplicateRanks: false,
    },
    options: [
      { id: 'opt1', value: 'opt1', label: '옵션1' },
      { id: 'opt2', value: 'opt2', label: '옵션2' },
      { id: 'opt3', value: 'opt3', label: '옵션3' },
    ],
  } as unknown as Question;
}

// ── isGroupedRankingQuestion ────────────────────────────────────────────────

describe('isGroupedRankingQuestion', () => {
  it('ranking 그룹이 1개 이상이면 true를 반환한다', () => {
    expect(isGroupedRankingQuestion(groupedRankingQ())).toBe(true);
  });

  it('choiceGroups 가 없으면 false를 반환한다', () => {
    expect(isGroupedRankingQuestion(flatRankingQ())).toBe(false);
  });

  it('radio/checkbox 그룹만 있고 ranking 그룹이 없으면 false를 반환한다', () => {
    const q = {
      ...flatRankingQ(),
      choiceGroups: [{ id: 'g1', type: 'radio', groupKey: 'rad1', label: '' }],
    } as unknown as Question;
    expect(isGroupedRankingQuestion(q)).toBe(false);
  });
});

// ── collectRankingGroups ────────────────────────────────────────────────────

describe('collectRankingGroups', () => {
  it('정의 순서대로 그룹을 반환한다: rnk1, rnk2, default', () => {
    const groups = collectRankingGroups(groupedRankingQ());
    expect(groups).toHaveLength(3);
    expect(groups[0]!.groupKey).toBe('rnk1');
    expect(groups[1]!.groupKey).toBe('rnk2');
    expect(groups[2]!.groupKey).toBe('default'); // 미소속 cellE
  });

  it('rnk1 그룹은 cellA, cellB를 가진다', () => {
    const groups = collectRankingGroups(groupedRankingQ());
    const rnk1 = groups.find((g) => g.groupKey === 'rnk1')!;
    expect(rnk1.cells.map((c) => c.id)).toEqual(['cellA', 'cellB']);
  });

  it('rnk2 그룹은 cellC, cellD를 가진다', () => {
    const groups = collectRankingGroups(groupedRankingQ());
    const rnk2 = groups.find((g) => g.groupKey === 'rnk2')!;
    expect(rnk2.cells.map((c) => c.id)).toEqual(['cellC', 'cellD']);
  });

  it('default 그룹(미소속)은 cellE를 가진다', () => {
    const groups = collectRankingGroups(groupedRankingQ());
    const def = groups.find((g) => g.groupKey === 'default')!;
    expect(def.cells.map((c) => c.id)).toEqual(['cellE']);
  });

  it('그룹 라벨을 올바르게 반환한다', () => {
    const groups = collectRankingGroups(groupedRankingQ());
    expect(groups.find((g) => g.groupKey === 'rnk1')!.label).toBe('그룹1');
    expect(groups.find((g) => g.groupKey === 'rnk2')!.label).toBe('그룹2');
    expect(groups.find((g) => g.groupKey === 'default')!.label).toBe(''); // 기본 그룹은 라벨 없음
  });

  it('비그룹 질문에서는 빈 배열을 반환한다', () => {
    expect(collectRankingGroups(flatRankingQ())).toHaveLength(0);
  });
});

// ── resolveRankingOptionsFromCells ─────────────────────────────────────────

describe('resolveRankingOptionsFromCells — 그룹 셀 변환', () => {
  it('rnk1 셀 배열을 QuestionOption 배열로 변환한다', () => {
    const q = groupedRankingQ();
    const groups = collectRankingGroups(q);
    const rnk1 = groups.find((g) => g.groupKey === 'rnk1')!;
    const opts = resolveRankingOptionsFromCells(rnk1.cells);
    expect(opts).toHaveLength(2);
    expect(opts[0]!.value).toBe('cellA');
    expect(opts[0]!.label).toBe('항목A');
    expect(opts[1]!.value).toBe('cellB');
    expect(opts[1]!.label).toBe('항목B');
  });

  it('그룹 내 spssNumericCode 는 그룹 내 1-based 순번이다', () => {
    const q = groupedRankingQ();
    const groups = collectRankingGroups(q);
    const rnk2 = groups.find((g) => g.groupKey === 'rnk2')!;
    const opts = resolveRankingOptionsFromCells(rnk2.cells);
    expect(opts[0]!.spssNumericCode).toBe(1); // 그룹 내 첫 번째
    expect(opts[1]!.spssNumericCode).toBe(2); // 그룹 내 두 번째
  });
});

// ── parseRankingAnswers — 그룹별 맵 값 정규화 ──────────────────────────────

describe('parseRankingAnswers — 그룹 값 정규화', () => {
  it('올바른 RankingAnswer 배열은 그대로 반환한다', () => {
    const answers: RankingAnswer[] = [
      { rank: 1, optionValue: 'cellA' },
      { rank: 2, optionValue: 'cellB' },
    ];
    expect(parseRankingAnswers(answers)).toEqual(answers);
  });

  it('배열이 아닌 값(맵 전체 등)은 빈 배열로 반환한다', () => {
    const groupedMap: GroupedRankingAnswer = {
      rnk1: [{ rank: 1, optionValue: 'cellA' }],
    };
    // parseRankingAnswers 는 RankingAnswer[] 를 기대하므로, 맵 전체를 넘기면 []
    expect(parseRankingAnswers(groupedMap)).toEqual([]);
  });

  it('빈 배열은 빈 배열로 반환한다', () => {
    expect(parseRankingAnswers([])).toEqual([]);
  });

  it('undefined 는 빈 배열로 반환한다', () => {
    expect(parseRankingAnswers(undefined)).toEqual([]);
  });
});

// ── GroupedRankingAnswer 응답 상태 관리 로직 ───────────────────────────────

describe('GroupedRankingAnswer 응답 상태 관리', () => {
  /**
   * handleGroupChange 동작을 순수 함수로 재현해 테스트.
   * ranking-question.tsx 의 handleGroupChange 와 동일한 로직.
   */
  function handleGroupChange(
    currentMap: GroupedRankingAnswer,
    groupKey: string,
    next: RankingAnswer[],
  ): GroupedRankingAnswer {
    const updated: GroupedRankingAnswer = {};
    for (const [k, v] of Object.entries(currentMap)) {
      updated[k] = parseRankingAnswers(v);
    }
    if (next.length === 0) {
      delete updated[groupKey];
    } else {
      updated[groupKey] = next;
    }
    return updated;
  }

  it('rnk1 1순위 cellA 선택 → { rnk1: [{rank:1, optionValue:"cellA"}] }', () => {
    const result = handleGroupChange({}, 'rnk1', [{ rank: 1, optionValue: 'cellA' }]);
    expect(result).toEqual({ rnk1: [{ rank: 1, optionValue: 'cellA' }] });
  });

  it('기존 rnk1 응답 있는 상태에서 rnk2 1순위 선택 → 두 키 공존', () => {
    const existing: GroupedRankingAnswer = {
      rnk1: [{ rank: 1, optionValue: 'cellA' }],
    };
    const result = handleGroupChange(existing, 'rnk2', [{ rank: 1, optionValue: 'cellC' }]);
    expect(result).toEqual({
      rnk1: [{ rank: 1, optionValue: 'cellA' }],
      rnk2: [{ rank: 1, optionValue: 'cellC' }],
    });
  });

  it('rnk1 전부 해제(next=[]) → rnk1 키 삭제, rnk2 키 유지', () => {
    const existing: GroupedRankingAnswer = {
      rnk1: [{ rank: 1, optionValue: 'cellA' }],
      rnk2: [{ rank: 1, optionValue: 'cellC' }],
    };
    const result = handleGroupChange(existing, 'rnk1', []);
    expect(result).toEqual({
      rnk2: [{ rank: 1, optionValue: 'cellC' }],
    });
    expect('rnk1' in result).toBe(false);
  });

  it('빈 맵에서 rnk1 전부 해제 → 빈 맵 반환', () => {
    const result = handleGroupChange({}, 'rnk1', []);
    expect(result).toEqual({});
  });

  it('같은 그룹에 여러 순위 응답 업데이트 → 덮어쓰기', () => {
    const existing: GroupedRankingAnswer = {
      rnk1: [{ rank: 1, optionValue: 'cellA' }],
    };
    const next: RankingAnswer[] = [
      { rank: 1, optionValue: 'cellA' },
      { rank: 2, optionValue: 'cellB' },
    ];
    const result = handleGroupChange(existing, 'rnk1', next);
    expect(result['rnk1']).toEqual(next);
  });
});

// ── cap 규칙: 그룹 멤버 수 < 질문 positions ────────────────────────────────

describe('그룹 cap 규칙', () => {
  it('rnk1 멤버 2 < positions 3 → groupPositions 는 2', () => {
    const q = groupedRankingQ();
    const requestedPositions = q.rankingConfig!.positions!; // 3
    const groups = collectRankingGroups(q);
    const rnk1 = groups.find((g) => g.groupKey === 'rnk1')!;
    const groupOptions = resolveRankingOptionsFromCells(rnk1.cells);
    const groupPositions = Math.min(requestedPositions, Math.max(groupOptions.length, 1));
    expect(groupPositions).toBe(2); // min(3, max(2, 1)) = 2
  });

  it('rnk2 멤버 2 < positions 3 → groupPositions 는 2', () => {
    const q = groupedRankingQ();
    const requestedPositions = q.rankingConfig!.positions!; // 3
    const groups = collectRankingGroups(q);
    const rnk2 = groups.find((g) => g.groupKey === 'rnk2')!;
    const groupOptions = resolveRankingOptionsFromCells(rnk2.cells);
    const groupPositions = Math.min(requestedPositions, Math.max(groupOptions.length, 1));
    expect(groupPositions).toBe(2); // min(3, max(2, 1)) = 2
  });

  it('default 그룹 멤버 1 < positions 3 → groupPositions 는 1', () => {
    const q = groupedRankingQ();
    const requestedPositions = q.rankingConfig!.positions!; // 3
    const groups = collectRankingGroups(q);
    const def = groups.find((g) => g.groupKey === 'default')!;
    const groupOptions = resolveRankingOptionsFromCells(def.cells);
    const groupPositions = Math.min(requestedPositions, Math.max(groupOptions.length, 1));
    expect(groupPositions).toBe(1); // min(3, max(1, 1)) = 1
  });

  it('멤버 수 >= positions 이면 cap 안 함', () => {
    const q = groupedRankingQ();
    const requestedPositions = 1; // positions 를 1로 줄여서 테스트
    const groups = collectRankingGroups(q);
    const rnk1 = groups.find((g) => g.groupKey === 'rnk1')!;
    const groupOptions = resolveRankingOptionsFromCells(rnk1.cells);
    const groupPositions = Math.min(requestedPositions, Math.max(groupOptions.length, 1));
    expect(groupPositions).toBe(1); // min(1, max(2, 1)) = 1
  });
});

// ── 비그룹 순위형: 기존 flat 동작 불변 ────────────────────────────────────

describe('비그룹 순위형 — 기존 flat 동작 불변', () => {
  it('isGroupedRankingQuestion 은 false를 반환한다', () => {
    expect(isGroupedRankingQuestion(flatRankingQ())).toBe(false);
  });

  it('collectRankingGroups 는 빈 배열을 반환한다', () => {
    expect(collectRankingGroups(flatRankingQ())).toHaveLength(0);
  });

  it('parseRankingAnswers 는 flat RankingAnswer[] 를 그대로 반환한다', () => {
    const answers: RankingAnswer[] = [
      { rank: 1, optionValue: 'opt1' },
      { rank: 2, optionValue: 'opt2' },
    ];
    expect(parseRankingAnswers(answers)).toEqual(answers);
  });
});
