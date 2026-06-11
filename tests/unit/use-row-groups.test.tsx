import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useRowGroups } from '@/hooks/use-row-groups';
import type { TableCell, TableRow } from '@/types/survey';

// ── 테스트 픽스처 헬퍼 ──

function textCell(id: string, content: string, rowspan?: number): TableCell {
  return {
    id,
    content,
    type: 'text',
    ...(rowspan != null ? { rowspan } : {}),
  };
}

function inputCell(id: string): TableCell {
  return { id, content: '', type: 'input' };
}

function row(id: string, cells: TableCell[], label = ''): TableRow {
  return { id, label, cells };
}

// rowspan 섹션 하나(선두 text 셀 + 입력 행들) 생성
function section(prefix: string, leadingText: string, rowCount: number): TableRow[] {
  const rows: TableRow[] = [];
  for (let r = 0; r < rowCount; r++) {
    const cells: TableCell[] =
      r === 0
        ? [textCell(`${prefix}-head`, leadingText, rowCount), inputCell(`${prefix}-in-0`)]
        : [inputCell(`${prefix}-in-${r}`)];
    rows.push(row(`${prefix}-row-${r}`, cells));
  }
  return rows;
}

describe('useRowGroups - detectRowGroups', () => {
  it('선두 텍스트가 동일한 두 rowspan 섹션은 label이 충돌해도 startIndex는 고유해야 한다', () => {
    // 두 섹션 모두 선두 text 셀 content 가 "1주차" — 실제 설문 매트릭스에서 흔한 케이스
    const rows: TableRow[] = [...section('a', '1주차', 3), ...section('b', '1주차', 2)];

    const { result } = renderHook(() => useRowGroups(rows));
    const groups = result.current;

    expect(groups).toHaveLength(2);

    // label 은 firstTextCell.content 기반이라 충돌한다(= React key 로 부적합)
    expect(groups[0]?.label).toBe('1주차');
    expect(groups[1]?.label).toBe('1주차');
    expect(groups[0]?.label).toBe(groups[1]?.label);

    // startIndex 는 비중첩 슬라이스 시작 위치라 항상 고유 — stepper 의 React key 로 안전
    const startIndices = groups.map((g) => g.startIndex);
    expect(startIndices).toEqual([0, 3]);
    expect(new Set(startIndices).size).toBe(startIndices.length);
  });

  it('각 그룹의 startIndex 는 행 슬라이스 시작 위치와 일치하고 단조 증가한다', () => {
    const rows: TableRow[] = [...section('a', 'A 구역', 2), ...section('b', 'B 구역', 4)];

    const { result } = renderHook(() => useRowGroups(rows));
    const groups = result.current;

    expect(groups).toHaveLength(2);
    expect(groups[0]?.startIndex).toBe(0);
    expect(groups[0]?.rows).toHaveLength(2);
    expect(groups[1]?.startIndex).toBe(2);
    expect(groups[1]?.rows).toHaveLength(4);
  });
});
