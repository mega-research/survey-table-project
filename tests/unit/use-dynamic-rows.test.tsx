import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDynamicRows } from '@/hooks/use-dynamic-rows';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { DynamicRowGroupConfig, TableRow } from '@/types/survey';

/**
 * 동적 행 파이프라인 facade(useDynamicRows) 테스트.
 *
 * interactive-table-response 에 흩어져 있던 접착 로직(가시 행 필터링 + 동적 그룹 제외 +
 * rowspan 재계산 경유 + 상태→레이아웃 배선 + 행 완료 맵)을 facade 로 옮기면서,
 * 그 의미론을 컴포넌트 마운트 없이 hook interface 에서 직접 고정한다.
 */

function makeRow(id: string, patch: Partial<TableRow> = {}): TableRow {
  return {
    id,
    label: id,
    cells: [{ id: `${id}-c0`, content: '', type: 'input' }],
    ...patch,
  } as TableRow;
}

// r1, r2 일반 / d1, d2 = 동적 그룹 g1 / s1 = g1 선택 시 노출(소계) / e1 = 동적 그룹 g2
function makeRows(): TableRow[] {
  return [
    makeRow('r1'),
    makeRow('r2'),
    makeRow('d1', { dynamicGroupId: 'g1' } as Partial<TableRow>),
    makeRow('d2', { dynamicGroupId: 'g1' } as Partial<TableRow>),
    makeRow('s1', { showWhenDynamicGroupId: 'g1' } as Partial<TableRow>),
    makeRow('e1', { dynamicGroupId: 'g2' } as Partial<TableRow>),
  ];
}

function makeConfigs(...groupIds: string[]): DynamicRowGroupConfig[] {
  return groupIds.map((groupId) => ({ groupId, enabled: true }));
}

interface HookProps {
  questionId?: string;
  rows?: TableRow[];
  columnFilteredRows?: TableRow[];
  conditionVisibleRowIds?: Set<string> | null;
  hiddenGroupIds?: Set<string>;
  dynamicRowConfigs?: DynamicRowGroupConfig[];
  isTestMode?: boolean;
  value?: Record<string, unknown>;
  onChange?: (v: Record<string, unknown>) => void;
  headerRowCount?: number;
}

function setup(props: HookProps = {}) {
  const rows = props.rows ?? makeRows();
  return renderHook(
    (p: HookProps) =>
      useDynamicRows({
        questionId: p.questionId ?? 'q1',
        rows: p.rows ?? rows,
        columnFilteredRows: p.columnFilteredRows ?? p.rows ?? rows,
        conditionVisibleRowIds: p.conditionVisibleRowIds ?? null,
        hiddenGroupIds: p.hiddenGroupIds,
        dynamicRowConfigs: p.dynamicRowConfigs,
        isTestMode: p.isTestMode ?? false,
        value: p.value,
        onChange: p.onChange as ((v: Record<string, any>) => void) | undefined,
        headerRowCount: p.headerRowCount ?? 1,
      }),
    { initialProps: props },
  );
}

beforeEach(() => {
  useTestResponseStore.getState().clearTestResponses();
});

describe('useDynamicRows — 가시 행 필터링 (이관된 접착 로직)', () => {
  it('동적 그룹 없음: 전체 행 패스스루 + 헤더 오프셋 grid 좌표', () => {
    const rows = [makeRow('r1'), makeRow('r2')];
    const { result } = setup({ rows, headerRowCount: 1 });

    expect(result.current.hasDynamicRows).toBe(false);
    expect(result.current.displayRows.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(result.current.rowGridMap.get('r1')).toBe(2); // headerRowCount 1 + 1
    expect(result.current.rowGridMap.get('r2')).toBe(3);
    expect(result.current.selectorGridMap.size).toBe(0);
  });

  it('conditionVisibleRowIds 지정 시 그 행만 표시, null 이면 필터 없음', () => {
    const rows = [makeRow('r1'), makeRow('r2')];
    const { result: filtered } = setup({ rows, conditionVisibleRowIds: new Set(['r1']) });
    expect(filtered.current.displayRows.map((r) => r.id)).toEqual(['r1']);

    const { result: unfiltered } = setup({ rows, conditionVisibleRowIds: null });
    expect(unfiltered.current.displayRows.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('동적 그룹 소속 행(dynamicGroupId·showWhenDynamicGroupId)은 메인 그리드에서 제외', () => {
    const { result } = setup({ dynamicRowConfigs: makeConfigs('g1', 'g2') });

    expect(result.current.hasDynamicRows).toBe(true);
    expect(result.current.displayRows.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(result.current.dynamicRows.map((r) => r.id)).toEqual(['d1', 'd2', 'e1']);
  });

  it('비활성(enabled=false) 그룹의 행은 제외되지 않는다', () => {
    const configs: DynamicRowGroupConfig[] = [
      { groupId: 'g1', enabled: false },
      { groupId: 'g2', enabled: true },
    ];
    const { result } = setup({ dynamicRowConfigs: configs });
    // g1 비활성 → d1/d2 는 일반 행처럼 표시, s1(showWhen g1)도 표시
    expect(result.current.displayRows.map((r) => r.id)).toEqual(['r1', 'r2', 'd1', 'd2', 's1']);
  });

  it('조건 필터와 동적 그룹 제외가 동시에 적용된다 — 조건이 동적 행을 포함해도 제외가 우선', () => {
    const { result } = setup({
      dynamicRowConfigs: makeConfigs('g1', 'g2'),
      conditionVisibleRowIds: new Set(['r1', 'd1', 's1']),
    });
    // d1/s1 은 조건상 보이지만 동적 제외로 빠지고, r2 는 조건으로 빠진다
    expect(result.current.displayRows.map((r) => r.id)).toEqual(['r1']);
  });

  it('병합 그룹 중간 행이 동적 제외로 숨겨지면 rowspan 이 축소된다', () => {
    const rows = [
      {
        id: 'm1',
        label: 'm1',
        cells: [
          { id: 'm1-c0', content: '병합', type: 'text', rowspan: 3 },
          { id: 'm1-c1', content: '', type: 'input' },
        ],
      },
      {
        id: 'm2',
        label: 'm2',
        dynamicGroupId: 'g1',
        cells: [
          { id: 'm2-c0', content: '', type: 'text', isHidden: true },
          { id: 'm2-c1', content: '', type: 'input' },
        ],
      },
      {
        id: 'm3',
        label: 'm3',
        cells: [
          { id: 'm3-c0', content: '', type: 'text', isHidden: true },
          { id: 'm3-c1', content: '', type: 'input' },
        ],
      },
    ] as unknown as TableRow[];
    const { result } = setup({ rows, dynamicRowConfigs: makeConfigs('g1') });

    expect(result.current.displayRows.map((r) => r.id)).toEqual(['m1', 'm3']);
    expect(result.current.displayRows[0]?.cells[0]?.rowspan).toBe(2);
  });

  it('빈 columnFilteredRows: 행 산출물은 비고, null 앵커 셀렉터는 헤더 아래 배치된다', () => {
    const { result } = setup({
      rows: makeRows(),
      columnFilteredRows: [],
      dynamicRowConfigs: makeConfigs('g1'),
    });
    expect(result.current.displayRows).toEqual([]);
    expect(result.current.rowCompletionMap.size).toBe(0);
    expect(result.current.selectorGridMap.get('g1')).toBe(2);
  });
});

describe('useDynamicRows — 선택 상태와 핸들러', () => {
  it('value.__selectedRowIds 를 중복 제거해 노출', () => {
    const { result } = setup({
      dynamicRowConfigs: makeConfigs('g1'),
      value: { __selectedRowIds: ['d1', 'd1', 'd2'] },
    });
    expect(result.current.selectedRowIds).toEqual(['d1', 'd2']);
  });

  it('groupSelectedCountMap: 그룹별 선택 행 수를 집계한다', () => {
    const { result } = setup({
      dynamicRowConfigs: makeConfigs('g1', 'g2'),
      value: { __selectedRowIds: ['d1', 'd2', 'e1'] },
    });
    expect(result.current.groupSelectedCountMap.get('g1')).toBe(2);
    expect(result.current.groupSelectedCountMap.get('g2')).toBe(1);
  });

  it('handleDynamicRowSelect: 다른 그룹의 기존 선택을 보존하고 onChange 로 병합 전달', () => {
    const onChange = vi.fn();
    const { result } = setup({
      dynamicRowConfigs: makeConfigs('g1', 'g2'),
      value: { __selectedRowIds: ['e1'] }, // g2 의 기존 선택
      onChange,
    });

    act(() => result.current.handleSelectGroup('g1'));
    expect(result.current.activeGroupId).toBe('g1');

    act(() => result.current.handleDynamicRowSelect(['d1']));
    expect(onChange).toHaveBeenCalledWith({ __selectedRowIds: ['e1', 'd1'] });
  });

  it('행 선택 시 해당 그룹 자동 펼침, closeModal 로 모달 닫힘', () => {
    const { result } = setup({
      dynamicRowConfigs: makeConfigs('g1'),
      onChange: vi.fn(),
    });

    act(() => result.current.handleSelectGroup('g1'));
    act(() => result.current.handleDynamicRowSelect(['d1']));
    expect(result.current.expandedGroupIds.has('g1')).toBe(true);

    act(() => result.current.closeModal());
    expect(result.current.activeGroupId).toBeNull();
  });

  it('테스트 모드: onChange 대신 testResponseStore 에 병합 기록', () => {
    useTestResponseStore.getState().updateTestResponse('q1', { 'r1-c0': '기존답' });
    const onChange = vi.fn();
    const { result } = setup({
      dynamicRowConfigs: makeConfigs('g1'),
      isTestMode: true,
      onChange,
    });

    act(() => result.current.handleSelectGroup('g1'));
    act(() => result.current.handleDynamicRowSelect(['d2']));

    expect(onChange).not.toHaveBeenCalled();
    expect(useTestResponseStore.getState().testResponses['q1']).toEqual({
      'r1-c0': '기존답',
      __selectedRowIds: ['d2'],
    });
    // currentResponse 도 store 를 따른다
    expect(result.current.currentResponse['r1-c0']).toBe('기존답');
  });
});

describe('useDynamicRows — 셀렉터 배치와 펼침', () => {
  it('null 앵커 셀렉터는 헤더 바로 아래(Phase 1), 데이터 행은 그 다음', () => {
    const { result } = setup({ dynamicRowConfigs: makeConfigs('g1'), headerRowCount: 2 });

    expect(result.current.selectorGridMap.get('g1')).toBe(3); // headerRowCount 2 + 1
    expect(result.current.rowGridMap.get('r1')).toBe(4);
  });

  it('insertAfterRowId 앵커: 해당 행 바로 다음에 셀렉터 배치', () => {
    const configs: DynamicRowGroupConfig[] = [
      { groupId: 'g1', enabled: true, insertAfterRowId: 'r1' },
    ];
    const { result } = setup({ dynamicRowConfigs: configs, headerRowCount: 1 });

    expect(result.current.rowGridMap.get('r1')).toBe(2);
    expect(result.current.selectorGridMap.get('g1')).toBe(3);
    expect(result.current.rowGridMap.get('r2')).toBe(4);
  });

  it('hiddenGroupIds 에 든 그룹은 셀렉터를 배치하지 않는다', () => {
    const { result } = setup({
      dynamicRowConfigs: makeConfigs('g1'),
      hiddenGroupIds: new Set(['g1']),
    });
    expect(result.current.selectorGridMap.has('g1')).toBe(false);
  });

  it('insertAfterRowId 앵커 행이 숨겨지면 가장 가까운 보이는 행으로 역추적', () => {
    // 동적 행(d1/d2)이 g1 에 실재해야 앵커가 생성된다 — 기본 픽스처 사용
    const configs: DynamicRowGroupConfig[] = [
      { groupId: 'g1', enabled: true, insertAfterRowId: 'r2' },
    ];
    const { result } = setup({
      dynamicRowConfigs: configs,
      conditionVisibleRowIds: new Set(['r1']),
    });
    // r2 숨김 → r1 로 역추적: r1(grid 2) 바로 다음에 셀렉터(3)
    expect(result.current.selectorGridMap.get('g1')).toBe(3);
  });

  it('앵커 후보가 전부 숨겨지면 null fallback 으로 헤더 바로 아래 배치', () => {
    const configs: DynamicRowGroupConfig[] = [
      { groupId: 'g1', enabled: true, insertAfterRowId: 'r2' },
    ];
    const { result } = setup({
      dynamicRowConfigs: configs,
      conditionVisibleRowIds: new Set<string>(),
    });
    expect(result.current.selectorGridMap.get('g1')).toBe(2);
  });

  it('숨김 그룹은 펼쳐져 있어도 grid 좌표를 받지 않고 가시 행의 슬롯도 소비하지 않는다', () => {
    const { result } = setup({
      dynamicRowConfigs: makeConfigs('g1'),
      hiddenGroupIds: new Set(['g1']),
      value: { __selectedRowIds: ['d1'] },
    });
    act(() => result.current.toggleGroupExpanded('g1'));

    expect(result.current.rowGridMap.has('d1')).toBe(false);
    expect(result.current.rowGridMap.get('r1')).toBe(2);
    // 완료 맵에는 펼친 행이 남는 비대칭은 pre-existing 동작 — 렌더가 .get 조회만 하므로 무해
    expect(result.current.rowCompletionMap.has('d1')).toBe(true);
  });

  it('펼친 그룹: 선택된 행 + showWhen 행이 expandedGroupRows 로 노출되고 grid 좌표를 받는다', () => {
    const { result } = setup({
      dynamicRowConfigs: makeConfigs('g1'),
      value: { __selectedRowIds: ['d1'] },
      headerRowCount: 1,
    });

    act(() => result.current.toggleGroupExpanded('g1'));

    const groupRows = result.current.expandedGroupRows.get('g1');
    expect(groupRows?.map((r) => r.id)).toEqual(['d1', 's1']);
    // null 앵커 Phase 1: 셀렉터(2) → 펼친 행 d1(3), s1(4) → 데이터 행 r1(5)
    expect(result.current.selectorGridMap.get('g1')).toBe(2);
    expect(result.current.rowGridMap.get('d1')).toBe(3);
    expect(result.current.rowGridMap.get('s1')).toBe(4);
    expect(result.current.rowGridMap.get('r1')).toBe(5);
  });
});

describe('useDynamicRows — 행 완료 맵 (이관된 접착 로직)', () => {
  it('displayRows 와 펼친 그룹 행 모두 완료 판정에 포함', () => {
    const { result } = setup({
      dynamicRowConfigs: makeConfigs('g1'),
      value: { __selectedRowIds: ['d1'], 'r1-c0': '답변', 'd1-c0': '동적답' },
    });

    act(() => result.current.toggleGroupExpanded('g1'));

    expect(result.current.rowCompletionMap.get('r1')).toBe(true);
    expect(result.current.rowCompletionMap.get('r2')).toBe(false);
    expect(result.current.rowCompletionMap.get('d1')).toBe(true); // 펼친 그룹 행
  });
});
