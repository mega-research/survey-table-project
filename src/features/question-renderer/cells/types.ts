import type { TableCell } from '@/types/survey';

/** 인터랙티브 셀 컴포넌트 공통 props */
export interface InteractiveCellProps {
  cell: TableCell;
  cellResponse: unknown;
  onUpdateValue: (value: string | string[] | object) => void;
  /**
   * 부모 테이블 질문의 ID. radio/checkbox/select 셀의 allowTextInput 옵션 텍스트를
   * 옵션 텍스트 원본(response-sources)의 [questionId][optionId] 키로 저장하기 위해 사용.
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
  /**
   * 캡션 오버라이드(image/video 셀 전용). 호출부가 토큰 치환을 끝낸 문구를 넘긴다.
   * 미지정 시 cell.content 를 셀이 직접 치환 — cell-options-container.tsx 와 동일한
   * opt-in 패턴(이미 치환된 셀을 넘겨받는 PreviewCell 경로의 이중 치환 방지).
   */
  content?: string | undefined;
}

/** 미리보기(읽기 전용) 셀 컴포넌트 공통 props */
export interface PreviewCellProps {
  cell: TableCell;
  /** 캡션 오버라이드(image/video 셀 전용). InteractiveCellProps.content 참조. */
  content?: string | undefined;
}
