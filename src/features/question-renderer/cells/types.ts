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
   * input 셀의 범위·형식 위반 안내를 흐름 안(입력칸 아래)에 그린다. 기본은 absolute 로 띄운다 —
   * 표 행에서는 이 셀만 키가 커져 옆 칸과 어긋나기 때문이다. overflow-hidden 컨테이너(모바일 카드,
   * 드릴다운 안의 원본 행 표)에서는 띄우면 잘리므로 흐름에 둔다.
   */
  hintInFlow?: boolean | undefined;
  /**
   * 입력칸 너비 고정(TableCell.inputWidth)을 무시하고 폭 전체를 쓴다 — 세로로 쌓인 카드(모바일 행
   * 카드·드릴다운 카드 목록)용. 좁은 화면에서 60px 입력칸은 불편하다. px 격자로 그리는 표(데스크톱,
   * 드릴다운 안의 원본 행 표, 행별 원본)는 너비를 그대로 적용한다.
   */
  ignoreInputWidth?: boolean | undefined;
  /**
   * 캡션 오버라이드(image/video 셀 전용). 호출부가 토큰 치환을 끝낸 문구를 넘긴다.
   * 미지정 시 cell.content 를 셀이 직접 치환 — cell-options-container.tsx 와 동일한
   * opt-in 패턴(이미 치환된 셀을 넘겨받는 PreviewCell 경로의 이중 치환 방지).
   */
  content?: string | undefined;
  /**
   * 이월 표시(빨강) 판정에 쓸 **이월 조각 오버라이드**. 미지정이면 셀이 컨텍스트에서
   * `questionId` + `cell.id` 로 직접 찾는다.
   *
   * 보기-소스 표 안의 선택형 셀만 넘긴다 — 그 값은 이월 응답의 제자리가 아니라
   * `__optTexts__` 사이드카에 인코딩돼 있어 셀이 스스로 찾을 수 없다.
   */
  priorChoiceValue?: unknown;
}

/** 미리보기(읽기 전용) 셀 컴포넌트 공통 props */
export interface PreviewCellProps {
  cell: TableCell;
  /** 캡션 오버라이드(image/video 셀 전용). InteractiveCellProps.content 참조. */
  content?: string | undefined;
}
