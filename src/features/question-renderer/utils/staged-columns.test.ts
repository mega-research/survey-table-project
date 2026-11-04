import { describe, expect, it } from 'vitest';

import type { TableColumn, TableRow } from '@/types/survey';

import {
  cellIdsOfColumnStepsBeyond,
  deriveOpenColumnStep,
  hiddenStagedColumnIds,
  isColumnStageable,
  maxColumnStep,
  stagedColumnAddLabel,
  stagedColumnOptionalCellIds,
  stageableColumns,
} from './staged-columns';

/**
 * 열 차례로 열기 — 「기타1·기타2·기타3」 처럼 단계(revealStep)를 적은 열을 처음엔 1단계까지만
 * 보이고 `+` 로 한 단계씩 연다. 열린 단계는 값에서 파생한다(행 차례로 열기와 같은 결).
 */
const columns: TableColumn[] = [
  { id: 'milk', label: '원유' },
  { id: 'n1', label: '기타1 원료명', revealStep: 1 },
  { id: 'q1', label: '기타1 투입량', revealStep: 1 },
  { id: 'n2', label: '기타2 원료명', revealStep: 2, revealAddLabel: '기타 원료 추가' },
  { id: 'q2', label: '기타2 투입량', revealStep: 2 },
  { id: 'n3', label: '기타3 원료명', revealStep: 3 },
  { id: 'q3', label: '기타3 투입량', revealStep: 3 },
];
const cells = (r: string) =>
  columns.map((c) => ({ id: `${r}-${c.id}`, type: 'input' as const, content: '', required: c.id === 'n2' }));
const rows: TableRow[] = [
  { id: 'r1', label: '국내산', cells: cells('r1') },
  { id: 'r2', label: '수입산', cells: cells('r2') },
] as TableRow[];

describe('maxColumnStep', () => {
  it('가장 큰 단계 — 단계 열이 없으면 1', () => {
    expect(maxColumnStep(columns)).toBe(3);
    expect(maxColumnStep([{ id: 'a', label: 'a' }])).toBe(1);
    expect(maxColumnStep([{ id: 'a', label: 'a', revealStep: 1 }])).toBe(1);
  });
});

describe('deriveOpenColumnStep', () => {
  it('값이 없으면 1단계', () => {
    expect(deriveOpenColumnStep(columns, rows, {})).toBe(1);
  });
  it('어느 행이든 값이 있는 마지막 단계까지 열린다', () => {
    expect(deriveOpenColumnStep(columns, rows, { 'r2-q3': '5' })).toBe(3);
    expect(deriveOpenColumnStep(columns, rows, { 'r1-n2': '연유', 'r1-milk': '1' })).toBe(2);
  });
  it('빈 문자열은 값이 아니다', () => {
    expect(deriveOpenColumnStep(columns, rows, { 'r1-n3': '  ' })).toBe(1);
  });
});

describe('hiddenStagedColumnIds', () => {
  it('열린 단계보다 뒤의 열만 가린다', () => {
    expect(hiddenStagedColumnIds(columns, 1)).toEqual(new Set(['n2', 'q2', 'n3', 'q3']));
    expect(hiddenStagedColumnIds(columns, 2)).toEqual(new Set(['n3', 'q3']));
    expect(hiddenStagedColumnIds(columns, 3)).toEqual(new Set());
  });
});

describe('cellIdsOfColumnStepsBeyond', () => {
  it('닫을 때 비울 칸 — 지정 단계 뒤 열의 모든 행 칸', () => {
    expect(cellIdsOfColumnStepsBeyond(columns, rows, 2).sort()).toEqual(['r1-n3', 'r1-q3', 'r2-n3', 'r2-q3']);
  });
});

describe('stagedColumnOptionalCellIds', () => {
  it('열리지 않은 단계의 칸은 필수에서 빠진다', () => {
    expect(stagedColumnOptionalCellIds(columns, rows, {})).toEqual(
      new Set(['r1-n2', 'r1-q2', 'r1-n3', 'r1-q3', 'r2-n2', 'r2-q2', 'r2-n3', 'r2-q3']),
    );
  });
  it('값이 들어와 열린 단계의 칸은 평범한 칸이다', () => {
    expect(stagedColumnOptionalCellIds(columns, rows, { 'r1-q2': '3' }).has('r1-n2')).toBe(false);
  });
  it('단계 열이 없는 표는 빈 집합', () => {
    expect(stagedColumnOptionalCellIds([{ id: 'a', label: 'a' }], rows, {}).size).toBe(0);
  });
});

describe('stagedColumnAddLabel', () => {
  it('단계 열 중 처음 적힌 문구, 없으면 null', () => {
    expect(stagedColumnAddLabel(columns)).toBe('기타 원료 추가');
    expect(stagedColumnAddLabel([{ id: 'a', label: 'a', revealStep: 2 }])).toBeNull();
  });
});

describe('보기·순위 옵션 칸이 든 열은 단계로 열지 않는다', () => {
  // 보기 옵션 칸의 선택은 칸 값이 아니라 표 응답 안 보기 그룹 맵(__choiceGroups)에 산다.
  // 열린 단계 파생·닫을 때 비우기가 칸 값만 보므로, 단계를 걸면 선택이 있어도 접히고 닫아도 선택이 남는다.
  // 행 차례로 열기의 묶음 제외 규칙(NON_STAGEABLE_CELL_TYPES)과 같다.
  const choiceColumns: TableColumn[] = [
    { id: 'a', label: '가' },
    { id: 'b', label: '나', revealStep: 2 },
  ];
  const choiceRows: TableRow[] = [
    {
      id: 'r1',
      label: '행',
      cells: [
        { id: 'ca', type: 'choice_opt', content: '' },
        { id: 'cb', type: 'choice_opt', content: '' },
      ],
    },
  ] as TableRow[];

  it('그런 열의 단계는 무시해 늘 보인다', () => {
    const effective = stageableColumns(choiceColumns, choiceRows);
    expect(maxColumnStep(effective)).toBe(1);
    expect(hiddenStagedColumnIds(effective, 1).size).toBe(0);
    expect(stagedColumnOptionalCellIds(choiceColumns, choiceRows, {}).size).toBe(0);
  });

  it('응답 칸만 든 열의 단계는 그대로 둔다', () => {
    expect(stageableColumns(columns, rows)).toBe(columns);
  });

  it('빌더 판정 — 그 열에 보기·순위 옵션 칸이 있는가', () => {
    expect(isColumnStageable(choiceRows, 1)).toBe(false);
    expect(isColumnStageable(rows, 3)).toBe(true);
  });
});

describe('열린 단계 파생은 응답 칸 값만 센다', () => {
  it('계산 칸 값(저장 경계가 넣는다)으로는 단계가 열리지 않는다', () => {
    const calcRows: TableRow[] = [
      {
        id: 'r1',
        label: '행',
        cells: columns.map((c) =>
          c.id === 'q2'
            ? { id: 'k', type: 'calc' as const, content: '' }
            : { id: `x-${c.id}`, type: 'input' as const, content: '' },
        ),
      },
    ] as TableRow[];
    expect(deriveOpenColumnStep(columns, calcRows, { k: '0' })).toBe(1);
  });
});
