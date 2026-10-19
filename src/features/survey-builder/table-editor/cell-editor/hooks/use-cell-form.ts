'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useReducer } from 'react';

import { TableCell } from '@/types/survey';
import { CellFormState, cellToFormState } from '@/features/survey-builder/table-editor/cell-editor/utils/serialize-cell';

/**
 * 셀 편집 폼 상태를 단일 소스로 관리하는 훅.
 *
 * 기존 모달의 35개 useState + 4중복(초기값/hydrate effect/cancel 롤백/save 직렬화)에서
 * hydrate 와 reset 을 한 곳(cellToFormState)으로 모아 drift 원천을 제거한다.
 *
 * - 모달이 열릴 때(isOpen) cell.id 가 바뀌면 자동으로 hydrate.
 *   (cell reference 만 바뀌는 경우는 무시 — 사용자가 편집 중인 로컬 상태가
 *    store 옛 값으로 reset 되지 않게 한다. feedback_useeffect_reset_object_deps 참조)
 * - reset() 은 취소 시 원본 cell 값으로 롤백.
 */

type Action =
  | { type: 'HYDRATE'; cell: TableCell }
  | { type: 'SET_FIELD'; field: keyof CellFormState; value: CellFormState[keyof CellFormState] };

function reducer(state: CellFormState, action: Action): CellFormState {
  switch (action.type) {
    case 'HYDRATE':
      return cellToFormState(action.cell);
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    default:
      return state;
  }
}

/** 폼 필드마다 `set<필드 이름>` setter 하나 — 필드를 더하면 setter 가 저절로 생긴다 */
export type CellFormSetters = {
  [K in keyof CellFormState as `set${Capitalize<K>}`]: (v: CellFormState[K]) => void;
};

// cellToFormState 는 객체 리터럴이라 값이 undefined 인 필드도 키로 갖는다
const CELL_FORM_FIELDS = Object.keys(
  cellToFormState({ id: '', type: 'text', content: '' }),
) as (keyof CellFormState)[];

export interface UseCellFormResult {
  form: CellFormState;
  setters: CellFormSetters;
  /** 원본 cell 값으로 폼 롤백 (취소 시) */
  reset: () => void;
}

export function useCellForm(cell: TableCell, isOpen: boolean): UseCellFormResult {
  const [form, dispatch] = useReducer(reducer, cell, cellToFormState);

  // 셀이 변경될 때 상태 동기화 (모달이 열릴 때마다 최신 셀 데이터 반영).
  // deps 를 cell?.id 로 좁힘 — 모달 안에서 셀 저장 등으로 cell reference 가 바뀌어도
  // 사용자가 편집 중인 로컬 state 가 store 의 옛 값으로 reset 되지 않도록 한다.
  // (feedback_useeffect_reset_object_deps 참조) — cell 객체는 effect event 로 실행 시점의
  // 최신값을 읽고, 트리거는 isOpen / cell?.id 에만 둔다.
  const hydrate = useEffectEvent(() => {
    if (isOpen && cell) {
      dispatch({ type: 'HYDRATE', cell });
    }
  });
  useEffect(() => {
    hydrate();
  }, [isOpen, cell?.id]);

  const reset = useCallback(() => {
    dispatch({ type: 'HYDRATE', cell });
  }, [cell]);

  const setters = useMemo(
    () =>
      Object.fromEntries(
        CELL_FORM_FIELDS.map((field) => [
          `set${field.charAt(0).toUpperCase()}${field.slice(1)}`,
          (value: CellFormState[typeof field]) => dispatch({ type: 'SET_FIELD', field, value }),
        ]),
      ) as CellFormSetters,
    [],
  );

  return { form, setters, reset };
}
