'use client';

import { useCallback, useEffect, useMemo, useReducer } from 'react';

import { TableCell } from '@/types/survey';
import {
  CellFormState,
  ContentType,
  cellToFormState,
} from '@/utils/serialize-cell';

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

export interface CellFormSetters {
  setContentType: (v: ContentType) => void;
  setTextContent: (v: string) => void;
  setImageUrl: (v: string) => void;
  setVideoUrl: (v: string) => void;
  setCheckboxOptions: (v: CellFormState['checkboxOptions']) => void;
  setRadioOptions: (v: CellFormState['radioOptions']) => void;
  setRadioGroupName: (v: string) => void;
  setSelectOptions: (v: CellFormState['selectOptions']) => void;
  setAllowOtherOption: (v: boolean) => void;
  setCellOptionsColumns: (v: number | undefined) => void;
  setInputPlaceholder: (v: string) => void;
  setInputMaxLength: (v: number | '') => void;
  setInputDefaultValueTemplate: (v: string) => void;
  setInputType: (v: 'text' | 'number') => void;
  setEmptyDefaultEnabled: (v: boolean) => void;
  setEmptyDefaultRaw: (v: string) => void;
  setMinSelections: (v: number | undefined) => void;
  setMaxSelections: (v: number | undefined) => void;
  setRankingOptions: (v: CellFormState['rankingOptions']) => void;
  setRankingConfig: (v: CellFormState['rankingConfig']) => void;
  setRankSuffixPattern: (v: string) => void;
  setRankVarNames: (v: string[]) => void;
  setRankingLabel: (v: string) => void;
  setCellSpssNumericCode: (v: number | '') => void;
  setIsOtherRankingCell: (v: boolean) => void;
  setChoiceLabel: (v: string) => void;
  setChoiceAllowTextInput: (v: boolean) => void;
  setChoiceBranchRule: (v: CellFormState['choiceBranchRule']) => void;
  setHorizontalAlign: (v: 'left' | 'center' | 'right') => void;
  setMobileDisplay: (v: CellFormState['mobileDisplay']) => void;
  setVerticalAlign: (v: 'top' | 'middle' | 'bottom') => void;
  setTextPosition: (v: CellFormState['textPosition']) => void;
  setIsMergeEnabled: (v: boolean) => void;
  setRowspan: (v: number | '') => void;
  setColspan: (v: number | '') => void;
  setCellCode: (v: string) => void;
  setIsCustomCellCode: (v: boolean) => void;
  setExportLabel: (v: string) => void;
  setIsCustomExportLabel: (v: boolean) => void;
  setSpssVarType: (v: CellFormState['spssVarType']) => void;
  setSpssMeasure: (v: CellFormState['spssMeasure']) => void;
}

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
  // (feedback_useeffect_reset_object_deps 참조)
  useEffect(() => {
    if (isOpen && cell) {
      dispatch({ type: 'HYDRATE', cell });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, cell?.id]);

  const reset = useCallback(() => {
    dispatch({ type: 'HYDRATE', cell });
  }, [cell]);

  const setters = useMemo<CellFormSetters>(() => {
    const set =
      <K extends keyof CellFormState>(field: K) =>
      (value: CellFormState[K]) =>
        dispatch({ type: 'SET_FIELD', field, value });
    return {
      setContentType: set('contentType'),
      setTextContent: set('textContent'),
      setImageUrl: set('imageUrl'),
      setVideoUrl: set('videoUrl'),
      setCheckboxOptions: set('checkboxOptions'),
      setRadioOptions: set('radioOptions'),
      setRadioGroupName: set('radioGroupName'),
      setSelectOptions: set('selectOptions'),
      setAllowOtherOption: set('allowOtherOption'),
      setCellOptionsColumns: set('cellOptionsColumns'),
      setInputPlaceholder: set('inputPlaceholder'),
      setInputMaxLength: set('inputMaxLength'),
      setInputDefaultValueTemplate: set('inputDefaultValueTemplate'),
      setInputType: set('inputType'),
      setEmptyDefaultEnabled: set('emptyDefaultEnabled'),
      setEmptyDefaultRaw: set('emptyDefaultRaw'),
      setMinSelections: set('minSelections'),
      setMaxSelections: set('maxSelections'),
      setRankingOptions: set('rankingOptions'),
      setRankingConfig: set('rankingConfig'),
      setRankSuffixPattern: set('rankSuffixPattern'),
      setRankVarNames: set('rankVarNames'),
      setRankingLabel: set('rankingLabel'),
      setCellSpssNumericCode: set('cellSpssNumericCode'),
      setIsOtherRankingCell: set('isOtherRankingCell'),
      setChoiceLabel: set('choiceLabel'),
      setChoiceAllowTextInput: set('choiceAllowTextInput'),
      setChoiceBranchRule: set('choiceBranchRule'),
      setHorizontalAlign: set('horizontalAlign'),
      setMobileDisplay: set('mobileDisplay'),
      setVerticalAlign: set('verticalAlign'),
      setTextPosition: set('textPosition'),
      setIsMergeEnabled: set('isMergeEnabled'),
      setRowspan: set('rowspan'),
      setColspan: set('colspan'),
      setCellCode: set('cellCode'),
      setIsCustomCellCode: set('isCustomCellCode'),
      setExportLabel: set('exportLabel'),
      setIsCustomExportLabel: set('isCustomExportLabel'),
      setSpssVarType: set('spssVarType'),
      setSpssMeasure: set('spssMeasure'),
    };
  }, []);

  return { form, setters, reset };
}
