import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDragCopy } from '@/components/survey-builder/table-editor/hooks/use-drag-copy';
import type { TableColumn, TableRow } from '@/types/survey';

/**
 * 영역 붙여넣기의 옵션 id 재발번 회귀 테스트.
 *
 * 배경: allowTextInput 사이드카 텍스트는 optionTexts[questionId][option.id] 로
 * 저장된다(option-text-input.tsx). 붙여넣기가 소스 셀의 option id 를 그대로
 * 복사하면 같은 질문 안에서 id 가 충돌해 두 셀의 기타 입력칸이 같은 슬롯을
 * 공유한다 — duplicateRow 와 동일한 미러링 버그의 드래그 복사 경로.
 * 선택 응답·게이팅 values 는 option.value 기준이므로 id 재발번은 안전하다.
 */

function makeRows(): TableRow[] {
  return [
    {
      id: 'r-src',
      label: '소스',
      cells: [
        {
          id: 'src-radio',
          type: 'radio',
          content: '',
          radioOptions: [
            { id: 'ro-1', label: '① 보기', value: '1', optionCode: '1', spssNumericCode: 1 },
            {
              id: 'ro-other',
              label: '② 기타',
              value: '2',
              optionCode: '2',
              spssNumericCode: 2,
              allowTextInput: true,
            },
          ],
        },
        {
          id: 'src-check',
          type: 'checkbox',
          content: '',
          checkboxOptions: [{ id: 'co-1', label: '보기', value: 'a' }],
        },
      ],
    },
    {
      id: 'r-dst',
      label: '대상',
      cells: [
        { id: 'dst-1', type: 'text', content: '' },
        { id: 'dst-2', type: 'text', content: '' },
      ],
    },
  ] as TableRow[];
}

const columns: TableColumn[] = [
  { id: 'c1', label: '1' },
  { id: 'c2', label: '2' },
] as TableColumn[];

function setup() {
  let rows = makeRows();
  const currentRowsRef = { current: rows };
  const setCurrentRows = (next: TableRow[]) => {
    rows = next;
    currentRowsRef.current = next;
  };
  const hook = renderHook(() =>
    useDragCopy({
      currentRowsRef,
      currentColumnsRef: { current: columns },
      questionCodeRef: { current: undefined },
      setCurrentRows,
      notifyChange: () => {},
      currentTitleRef: { current: '' },
      recalculateHiddenCells: (r) => r,
      clearCopiedCell: () => {},
    }),
  );
  return { hook, getRows: () => rows };
}

function cellById(rows: TableRow[], id: string) {
  return rows.flatMap((r) => r.cells).find((c) => c.id === id);
}

describe('영역 붙여넣기 — 옵션 id 재발번', () => {
  it('붙여넣은 셀의 radio/checkbox 옵션 id 를 새로 발번한다 (소스와 미공유)', () => {
    const { hook, getRows } = setup();

    act(() => hook.result.current.startDragCopy(0, 0));
    act(() => hook.result.current.updateDragCopyRange(0, 1));
    act(() => {
      hook.result.current.storeSelectedRegion();
    });
    act(() => {
      const result = hook.result.current.pasteRegion(1, 0);
      expect('success' in result && result.success).toBe(true);
    });

    const rows = getRows();
    const srcIds = [
      ...(cellById(rows, 'src-radio')?.radioOptions ?? []),
      ...(cellById(rows, 'src-check')?.checkboxOptions ?? []),
    ].map((o) => o.id);
    const pastedIds = [
      ...(cellById(rows, 'dst-1')?.radioOptions ?? []),
      ...(cellById(rows, 'dst-2')?.checkboxOptions ?? []),
    ].map((o) => o.id);

    expect(pastedIds).toHaveLength(srcIds.length);
    for (const id of pastedIds) {
      expect(srcIds).not.toContain(id);
    }
    expect(new Set(pastedIds).size).toBe(pastedIds.length);
  });

  it('id 외의 옵션 필드는 보존하고, 소스 셀 옵션은 그대로 둔다', () => {
    const { hook, getRows } = setup();

    act(() => hook.result.current.startDragCopy(0, 0));
    act(() => hook.result.current.updateDragCopyRange(0, 1));
    act(() => {
      hook.result.current.storeSelectedRegion();
    });
    act(() => {
      hook.result.current.pasteRegion(1, 0);
    });

    const rows = getRows();
    const pastedOther = cellById(rows, 'dst-1')?.radioOptions?.[1];
    expect(pastedOther?.label).toBe('② 기타');
    expect(pastedOther?.value).toBe('2');
    expect(pastedOther?.optionCode).toBe('2');
    expect(pastedOther?.spssNumericCode).toBe(2);
    expect(pastedOther?.allowTextInput).toBe(true);

    expect(cellById(rows, 'src-radio')?.radioOptions?.map((o) => o.id)).toEqual([
      'ro-1',
      'ro-other',
    ]);
  });
});
