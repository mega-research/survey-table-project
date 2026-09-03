import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTableEditor } from '@/features/survey-builder/table-editor/hooks/use-table-editor';
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

/**
 * duplicateRow 의 옵션 id 재발번 회귀 테스트.
 *
 * 배경: allowTextInput 사이드카 텍스트는 optionTexts[questionId][option.id] 로
 * 저장된다(option-text-input.tsx). 행 복제가 radioOptions 등의 option id 를 그대로
 * 복사하면 같은 질문 안에서 id 가 충돌해 두 행의 기타 입력칸이 같은 스토어 슬롯을
 * 공유한다 — 한쪽에 타이핑하면 다른 행도 동시에 입력되는 미러링 버그.
 * 선택 응답·게이팅 values 는 option.value 기준이므로 id 재발번은 안전하다.
 */
function makeOptionRows(): TableRow[] {
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
          type: 'radio',
          radioOptions: [
            { id: 'radio-opt-1', label: '① 보기', value: '1', optionCode: '1', spssNumericCode: 1 },
            {
              id: 'radio-opt-other',
              label: '② 기타',
              value: '2',
              optionCode: '2',
              spssNumericCode: 2,
              allowTextInput: true,
            },
          ],
        },
        {
          id: 'cell-1-2',
          content: '',
          type: 'checkbox',
          checkboxOptions: [{ id: 'check-opt-1', label: '보기', value: 'a' }],
        },
        {
          id: 'cell-1-3',
          content: '',
          type: 'select',
          selectOptions: [{ id: 'select-opt-1', label: '보기', value: 's1' }],
        },
        {
          id: 'cell-1-4',
          content: '',
          type: 'ranking',
          rankingOptions: [{ id: 'rank-opt-1', label: '보기', value: 'r1' }],
        },
      ],
    },
  ];
}

function setupWithOptions() {
  const onTableChange = vi.fn();
  const columns: TableColumn[] = [
    { id: 'col-1', label: '열 1', width: 150 },
    { id: 'col-2', label: '열 2', width: 150 },
    { id: 'col-3', label: '열 3', width: 150 },
    { id: 'col-4', label: '열 4', width: 150 },
  ];
  const hook = renderHook(() =>
    useTableEditor({
      tableTitle: '표 질문',
      columns,
      rows: makeOptionRows(),
      currentQuestionId: 'q1',
      questionCode: 'Q1',
      questionTitle: '표 질문',
      onTableChange,
    }),
  );
  return { hook, onTableChange };
}

describe('useTableEditor.duplicateRow — 옵션 id 재발번', () => {
  it('복제된 행의 radio/checkbox/select/ranking 옵션 id 를 모두 새로 발번한다', () => {
    const { hook } = setupWithOptions();

    act(() => {
      hook.result.current.actions.duplicateRow(0);
    });

    const rows = hook.result.current.state.currentRows;
    expect(rows).toHaveLength(2);
    const [original, duplicated] = rows;

    const originalIds = [
      ...(original!.cells[0]!.radioOptions ?? []),
      ...(original!.cells[1]!.checkboxOptions ?? []),
      ...(original!.cells[2]!.selectOptions ?? []),
      ...(original!.cells[3]!.rankingOptions ?? []),
    ].map((o) => o.id);
    const duplicatedIds = [
      ...(duplicated!.cells[0]!.radioOptions ?? []),
      ...(duplicated!.cells[1]!.checkboxOptions ?? []),
      ...(duplicated!.cells[2]!.selectOptions ?? []),
      ...(duplicated!.cells[3]!.rankingOptions ?? []),
    ].map((o) => o.id);

    expect(duplicatedIds).toHaveLength(originalIds.length);
    for (const id of duplicatedIds) {
      expect(originalIds).not.toContain(id);
    }
    // 복제본 내부에서도 유일해야 한다
    expect(new Set(duplicatedIds).size).toBe(duplicatedIds.length);
  });

  it('id 외의 옵션 필드(label/value/optionCode/spssNumericCode/allowTextInput)는 보존한다', () => {
    const { hook } = setupWithOptions();

    act(() => {
      hook.result.current.actions.duplicateRow(0);
    });

    const duplicated = hook.result.current.state.currentRows[1];
    const otherOption = duplicated!.cells[0]!.radioOptions![1]!;
    expect(otherOption.label).toBe('② 기타');
    expect(otherOption.value).toBe('2');
    expect(otherOption.optionCode).toBe('2');
    expect(otherOption.spssNumericCode).toBe(2);
    expect(otherOption.allowTextInput).toBe(true);
  });

  it('원본 행의 옵션 id 는 그대로 유지된다', () => {
    const { hook } = setupWithOptions();

    act(() => {
      hook.result.current.actions.duplicateRow(0);
    });

    const original = hook.result.current.state.currentRows[0];
    expect(original!.cells[0]!.radioOptions!.map((o) => o.id)).toEqual([
      'radio-opt-1',
      'radio-opt-other',
    ]);
  });
});

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
