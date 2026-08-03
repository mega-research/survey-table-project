import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTableEditor } from '@/components/survey-builder/hooks/use-table-editor';
import type { TableColumn, TableRow } from '@/types/survey';

/**
 * duplicateRow 의 응답 인용 이름 격리(I-3) 회귀 테스트.
 *
 * 배경: 표 셀은 각자 질문 노릇을 할 수 있고, 그 질문 정체성을 나타내는 것이 셀의
 * answerQuoteName 이다(설문 전역 식별자 — 같은 이름을 가진 셀들은 응답 페이지에서
 * 하나의 문구로 조용히 합쳐진다). 6행 표를 만드는 자연스러운 방법인 "1행을 5번 복제"가
 * 그 이름을 그대로 복사해버리면 6행이 사실은 서로 다른 질문이라는 기능의 존재 이유가
 * 깨진다. duplicateRow 는 이미 cellCode 재생성 · rowspan 제거 등 위치/정체성 종속 필드를
 * 씻어내므로, 이 두 필드도 같은 취급을 받아야 한다.
 */

const COLUMNS: TableColumn[] = [{ id: 'col-1', label: '열 1', width: 150 }];

function makeRows(): TableRow[] {
  return [
    {
      id: 'row-1',
      label: '행 1',
      height: 60,
      minHeight: 40,
      cells: [
        {
          id: 'cell-1-1',
          content: '',
          type: 'input',
          answerQuoteEnabled: true,
          answerQuoteName: '인력',
          answerQuoteText: '{{입력}}명',
        },
      ],
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

describe('useTableEditor.duplicateRow — 응답 인용 토글·이름 격리 (I-3)', () => {
  it('복제된 행의 셀에서 answerQuoteEnabled/answerQuoteName 을 제거한다', () => {
    const { hook } = setup();

    act(() => {
      hook.result.current.actions.duplicateRow(0);
    });

    const rows = hook.result.current.state.currentRows;
    expect(rows).toHaveLength(2);
    const duplicatedCell = rows[1]?.cells[0];
    expect(duplicatedCell).toBeDefined();
    expect(duplicatedCell).not.toHaveProperty('answerQuoteEnabled');
    expect(duplicatedCell).not.toHaveProperty('answerQuoteName');
  });

  it('원본 행의 이름은 그대로 유지된다 (제거 대상은 복제본뿐)', () => {
    const { hook } = setup();

    act(() => {
      hook.result.current.actions.duplicateRow(0);
    });

    const rows = hook.result.current.state.currentRows;
    const originalCell = rows[0]?.cells[0];
    expect(originalCell?.answerQuoteEnabled).toBe(true);
    expect(originalCell?.answerQuoteName).toBe('인력');
  });

  it('answerQuoteText(문구)는 이름과 달리 위치 종속이 아니므로 복제본에도 보존된다', () => {
    const { hook } = setup();

    act(() => {
      hook.result.current.actions.duplicateRow(0);
    });

    const rows = hook.result.current.state.currentRows;
    expect(rows[1]?.cells[0]?.answerQuoteText).toBe('{{입력}}명');
  });
});
