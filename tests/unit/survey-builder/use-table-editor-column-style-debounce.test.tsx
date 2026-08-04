import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTableEditor } from '@/components/survey-builder/hooks/use-table-editor';
import type { TableColumn, TableRow } from '@/types/survey';

/**
 * updateColumnStyle 의 pending debounce 취소 회귀 테스트 (M1).
 *
 * 배경: notifyChangeDebounced 는 인자로 받은 cols 를 값으로 캡처한다. 열 코드를
 * 입력하면(updateColumnCode) 300ms 짜리 부모 알림 타이머가 예약되는데, 그 타이머가
 * 캡처한 cols 에는 이후에 적용한 스타일이 반영되어 있지 않다. 타이머가 취소되지
 * 않은 채 발화하면 stale cols 가 부모 state 를 덮어써 방금 적용한 스타일이 조용히
 * 사라진다. updateColumnStyle 은 applyHeaderStyle 과 동일하게 이 pending 타이머를
 * 먼저 비워야 한다.
 */

const COLUMNS: TableColumn[] = [{ id: 'col-1', label: '열 1', columnCode: 'c1', width: 150 }];

function makeRows(): TableRow[] {
  return [
    {
      id: 'row-1',
      label: '행 1',
      height: 60,
      minHeight: 40,
      cells: [{ id: 'cell-1-1', content: '', type: 'text' }],
    },
  ];
}

function setup() {
  const onTableChange = vi.fn();
  const hook = renderHook(() =>
    useTableEditor({
      tableTitle: '표 질문',
      columns: COLUMNS,
      rows: makeRows(),
      currentQuestionId: 'q1',
      questionCode: 'Q1',
      questionTitle: '표 질문',
      onTableChange,
    }),
  );
  return { hook, onTableChange };
}

describe('useTableEditor.updateColumnStyle — pending debounce 취소 (M1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('열 코드 입력 직후 스타일을 적용하면 stale debounce 가 스타일을 덮어쓰지 않는다', () => {
    const { hook, onTableChange } = setup();

    // 열 코드 입력: 300ms 짜리 부모 알림 debounce 예약 (아직 스타일 없는 cols 캡처)
    act(() => {
      hook.result.current.actions.updateColumnCode(0, 'c1x');
    });

    // 타이머 발화 전(150ms 시점)에 스타일 적용
    act(() => {
      vi.advanceTimersByTime(150);
      hook.result.current.actions.updateColumnStyle(0, {
        textBold: true,
        backgroundColor: '#ff0000',
        textColor: '',
      });
    });

    // updateColumnStyle 은 debounce 없이 즉시 커밋하므로 onTableChange 가 바로 호출된다.
    const immediateCall = onTableChange.mock.calls.at(-1)?.[0];
    expect(immediateCall?.tableColumns[0]).toMatchObject({
      columnCode: 'c1x',
      textBold: true,
      backgroundColor: '#ff0000',
    });

    // 원래 예약돼 있던 debounce(300ms 시점)가 취소됐으므로, 남은 시간을 흘려보내도
    // stale cols(스타일 없는 값)로 되돌리는 재호출이 없어야 한다.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    const lastCall = onTableChange.mock.calls.at(-1)?.[0];
    expect(lastCall?.tableColumns[0]).toMatchObject({
      columnCode: 'c1x',
      textBold: true,
      backgroundColor: '#ff0000',
    });

    // 스토어 상태 자체도 스타일을 유지해야 한다.
    const currentColumns = hook.result.current.state.currentColumns;
    expect(currentColumns[0]).toMatchObject({
      columnCode: 'c1x',
      textBold: true,
      backgroundColor: '#ff0000',
    });
  });
});
