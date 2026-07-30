import type { TableCell } from '@/types/survey';

/** 인터랙티브 셀 컴포넌트 공통 props */
export interface InteractiveCellProps {
  cell: TableCell;
  cellResponse: unknown;
  onUpdateValue: (value: string | string[] | object) => void;
  /**
   * 부모 테이블 질문의 ID. radio/checkbox/select 셀의 allowTextInput 옵션 텍스트를
   * useSurveyResponseStore.optionTexts[questionId][optionId] 키로 저장하기 위해 사용.
   */
  questionId: string;
  /**
   * Phase 5-D: 같은 행 + 같은 radioGroupName 셀들을 묶기 위한 HTML <input name> 값.
   * 브라우저 네이티브 single-select 동작과 키보드 네비게이션을 활성화한다.
   * radio 셀에서만 의미 있음.
   */
  groupName?: string;
  inputIdScope?: string | undefined;
  ariaInvalid?: boolean | undefined;
  ariaDescribedBy?: string | undefined;
}

/** 미리보기(읽기 전용) 셀 컴포넌트 공통 props */
export interface PreviewCellProps {
  cell: TableCell;
}
