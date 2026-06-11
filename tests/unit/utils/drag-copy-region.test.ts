import { describe, expect, it } from 'vitest';

import type { TableCell, TableRow } from '@/types/survey';
import {
  createRadioGroupRemapper,
  extractRegionFromRows,
} from '@/components/survey-builder/utils/drag-copy-utils';

/**
 * use-drag-copy 의심 검증: 영역 복사 데이터 누락 가능성.
 *
 * 소비 측(use-drag-copy.ts pasteRegion)은 `region.cells[rr][cc]` 를
 * 0 <= rr < region.height, 0 <= cc < region.width 범위로 순회한다.
 * 그 사이 셀이 undefined 이면 소비 측이 silently skip → 데이터 누락.
 *
 * 이 테스트는 생성 측(extractRegionFromRows)이 항상 직사각형
 * (height행 × width열, 빈 칸 = null, undefined 없음)을 보장함을 증명한다.
 * = 누락이 발생하는 hole(undefined) 이 만들어질 수 없음을 코드로 증명.
 */

// ── 픽스처 헬퍼 ──

function cell(overrides: Partial<TableCell> = {}): TableCell {
  return {
    id: `cell-${Math.random().toString(36).slice(2, 8)}`,
    content: 'x',
    type: 'text',
    ...overrides,
  };
}

function row(cells: TableCell[], overrides: Partial<TableRow> = {}): TableRow {
  return {
    id: `row-${Math.random().toString(36).slice(2, 8)}`,
    label: 'r',
    cells,
    ...overrides,
  };
}

/**
 * 직사각형 불변식 단언: cells.length === height, 각 행.length === width,
 * 그리고 어떤 칸도 undefined 가 아님 (TableCell | null 만 허용).
 */
function assertRectangular(
  region: { cells: (TableCell | null)[][]; width: number; height: number },
) {
  expect(region.cells.length).toBe(region.height);
  for (let rr = 0; rr < region.height; rr++) {
    const rowCells = region.cells[rr];
    expect(rowCells).toBeDefined();
    expect(rowCells!.length).toBe(region.width);
    for (let cc = 0; cc < region.width; cc++) {
      // null 은 허용(hidden 위치), undefined 는 누락이므로 금지
      expect(rowCells![cc]).not.toBeUndefined();
    }
  }
}

describe('extractRegionFromRows 직사각형 불변식', () => {
  it('일반 영역: 모든 칸이 채워진 height×width 직사각형', () => {
    const rows = [
      row([cell({ content: 'a' }), cell({ content: 'b' }), cell({ content: 'c' })]),
      row([cell({ content: 'd' }), cell({ content: 'e' }), cell({ content: 'f' })]),
    ];

    const region = extractRegionFromRows(0, 1, 0, 2, rows);

    expect(region.height).toBe(2);
    expect(region.width).toBe(3);
    assertRectangular(region);
    expect(region.cells[0]![0]!.content).toBe('a');
    expect(region.cells[1]![2]!.content).toBe('f');
  });

  it('hidden 셀(병합 커버): 구멍이 아니라 null 로 채워진다', () => {
    // (0,0) colspan=2 앵커, (0,1) 은 isHidden 으로 커버됨
    const rows = [
      row([cell({ content: 'anchor', colspan: 2 }), cell({ content: 'hidden', isHidden: true })]),
      row([cell({ content: 'd' }), cell({ content: 'e' })]),
    ];

    const region = extractRegionFromRows(0, 1, 0, 1, rows);

    expect(region.height).toBe(2);
    expect(region.width).toBe(2);
    assertRectangular(region);
    // hidden 위치는 null (undefined 아님)
    expect(region.cells[0]![1]).toBeNull();
    // 앵커는 보존
    expect(region.cells[0]![0]!.content).toBe('anchor');
  });

  it('rowspan 병합: 세로로 가려진 셀도 null, undefined 없음', () => {
    const rows = [
      row([cell({ content: 'tall', rowspan: 2 }), cell({ content: 'b' })]),
      row([cell({ content: 'covered', isHidden: true }), cell({ content: 'd' })]),
    ];

    const region = extractRegionFromRows(0, 1, 0, 1, rows);

    assertRectangular(region);
    expect(region.cells[1]![0]).toBeNull();
    expect(region.cells[0]![0]!.content).toBe('tall');
  });

  it('ragged source row(짧은 행): 부족한 칸은 null 로 패딩되어 width 유지', () => {
    // 두 번째 행이 1칸뿐 — width=3 선택 시 c=1,2 는 undefined 접근 → null 패딩되어야 함
    const rows = [
      row([cell({ content: 'a' }), cell({ content: 'b' }), cell({ content: 'c' })]),
      row([cell({ content: 'only' })]),
    ];

    const region = extractRegionFromRows(0, 1, 0, 2, rows);

    expect(region.height).toBe(2);
    expect(region.width).toBe(3);
    assertRectangular(region);
    expect(region.cells[1]![0]!.content).toBe('only');
    // 존재하지 않던 칸은 null (소비 측이 silently drop 할 undefined 가 아님)
    expect(region.cells[1]![1]).toBeNull();
    expect(region.cells[1]![2]).toBeNull();
  });

  it('범위가 rows 끝을 넘어가도 행 수는 height 로 유지, 칸은 null', () => {
    // rows 는 1행뿐인데 maxRow=2 (3행) 요청
    const rows = [row([cell({ content: 'a' }), cell({ content: 'b' })])];

    const region = extractRegionFromRows(0, 2, 0, 1, rows);

    expect(region.height).toBe(3);
    expect(region.width).toBe(2);
    assertRectangular(region);
    // 존재하지 않는 행 전체가 null 들로 채워진 길이 width 배열
    expect(region.cells[1]).toEqual([null, null]);
    expect(region.cells[2]).toEqual([null, null]);
  });

  it('1x1 단일 셀도 직사각형 불변식 충족', () => {
    const rows = [row([cell({ content: 'solo' })])];

    const region = extractRegionFromRows(0, 0, 0, 0, rows);

    expect(region.height).toBe(1);
    expect(region.width).toBe(1);
    assertRectangular(region);
    expect(region.cells[0]![0]!.content).toBe('solo');
  });

  // 라디오 그룹 보존(M51): 같은 radioGroupName 을 공유하는 라디오 셀들을 영역 복사하면
  // 스냅샷에 원본 그룹명이 남아 있어야 붙여넣기 시 상대 그룹 관계를 복원할 수 있다.
  it('라디오 그룹명을 스냅샷에 보존한다(붙여넣기 재매핑 입력용)', () => {
    const rows = [
      row([
        cell({ type: 'radio', radioGroupName: 'pay', content: '현금' }),
        cell({ type: 'radio', radioGroupName: 'pay', content: '카드' }),
      ]),
    ];

    const region = extractRegionFromRows(0, 0, 0, 1, rows);

    expect(region.cells[0]![0]!.radioGroupName).toBe('pay');
    expect(region.cells[0]![1]!.radioGroupName).toBe('pay');
  });

  it('소비 측 순회 시뮬레이션: 모든 (rr,cc) 접근이 undefined 가 아님', () => {
    // 병합 + hidden + ragged 가 섞인 까다로운 영역
    const rows = [
      row([cell({ content: 'a', colspan: 2 }), cell({ isHidden: true }), cell({ content: 'c' })]),
      row([cell({ content: 'd' })]), // ragged
      row([cell({ content: 'g' }), cell({ content: 'h' }), cell({ content: 'i' })]),
    ];

    const region = extractRegionFromRows(0, 2, 0, 2, rows);

    // use-drag-copy.ts pasteRegion 과 동일한 순회 패턴 재현
    let undefinedHits = 0;
    for (let rr = 0; rr < region.height; rr++) {
      const sourceCellRow = region.cells[rr];
      for (let cc = 0; cc < region.width; cc++) {
        const sourceCell = sourceCellRow ? sourceCellRow[cc] : undefined;
        if (sourceCell === undefined) undefinedHits++;
      }
    }

    // undefined = silently dropped = 데이터 누락. 0 이어야 버그 아님 증명.
    expect(undefinedHits).toBe(0);
  });
});

/**
 * M51 회귀: 같은 radioGroupName 을 공유하는 라디오 셀들을 영역 복사·붙여넣기 할 때
 * 셀마다 독립적인 새 그룹명이 발급되어 단일 선택 그룹이 깨지던 버그.
 *
 * 수정 전: 각 라디오 셀이 generateId() 로 distinct 그룹명을 받아, 응답 시
 * radioGroupBuckets 가 singleton 두 개가 되고 resolveRadioGroupProps 가 {} 반환 →
 * HTML name 미공유 + 형제 클리어 미적용 → 두 라디오 동시 선택 가능 / SPSS 그룹 변수 분리.
 *
 * createRadioGroupRemapper 는 원본 그룹명 단위로만 새 ID 를 공유해 이를 방지한다.
 */
describe('createRadioGroupRemapper 라디오 그룹 보존', () => {
  it('같은 원본 그룹명은 하나의 새 그룹명을 공유한다', () => {
    let counter = 0;
    const remap = createRadioGroupRemapper(() => `new-${++counter}`);

    const a = remap('pay');
    const b = remap('pay');

    expect(a).toBe(b); // 같은 원본 그룹 → 같은 새 그룹명
    expect(a).toBe('new-1');
  });

  it('원본 그룹명은 항상 새 ID 로 교체되어 영역 밖 셀과 충돌하지 않는다', () => {
    const remap = createRadioGroupRemapper(() => 'fresh');
    expect(remap('pay')).toBe('fresh');
    expect(remap('pay')).not.toBe('pay'); // 원본 ID 그대로 재사용 금지
  });

  it('서로 다른 원본 그룹명은 서로 다른 새 그룹명을 받는다', () => {
    let counter = 0;
    const remap = createRadioGroupRemapper(() => `new-${++counter}`);

    const pay = remap('pay');
    const ship = remap('ship');

    expect(pay).not.toBe(ship);
    expect(pay).toBe('new-1');
    expect(ship).toBe('new-2');
  });

  it('원본 그룹명이 없으면(undefined/빈문자열) 매번 고유한 새 ID 를 발급한다', () => {
    let counter = 0;
    const remap = createRadioGroupRemapper(() => `new-${++counter}`);

    const a = remap(undefined);
    const b = remap(undefined);
    const c = remap('');

    expect(a).toBe('new-1');
    expect(b).toBe('new-2');
    expect(c).toBe('new-3');
    expect(new Set([a, b, c]).size).toBe(3); // 모두 distinct
  });
});
