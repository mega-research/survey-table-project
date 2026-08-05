'use client';

import React, { useCallback, useEffect } from 'react';

import { isCellEnabled } from '@/lib/survey/cell-gating';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { TableCell } from '@/types/survey';

import { CalcCell } from './calc-cell';
import { CheckboxCell } from './checkbox-cell';
import { ImageCell } from './image-cell';
import { InputCell } from './input-cell';
import { RadioCell } from './radio-cell';
import { RankingCell } from './ranking-cell';
import { RankingOptCell } from './ranking-opt-cell';
import { SelectCell } from './select-cell';
import { TextCell } from './text-cell';
import type { InteractiveCellProps } from './types';
import { useCellResponse } from './use-cell-response';
import { VideoCell } from './video-cell';

// ── 내부 라우터 (cellResponse 주입 후 분기) ──

const CellRouter = React.memo(function CellRouter({
  cell,
  cellResponse,
  onUpdateValue,
  questionId,
  groupName,
  inputIdScope,
  ariaInvalid,
  ariaDescribedBy,
  gatingDisabled,
}: InteractiveCellProps) {
  switch (cell.type) {
    case 'checkbox':
      return <CheckboxCell cell={cell} cellResponse={cellResponse} onUpdateValue={onUpdateValue} questionId={questionId} inputIdScope={inputIdScope} ariaInvalid={ariaInvalid} ariaDescribedBy={ariaDescribedBy} />;
    case 'radio':
      return <RadioCell cell={cell} cellResponse={cellResponse} onUpdateValue={onUpdateValue} questionId={questionId} inputIdScope={inputIdScope} ariaInvalid={ariaInvalid} ariaDescribedBy={ariaDescribedBy} {...(groupName !== undefined ? { groupName } : {})} />;
    case 'select':
      return <SelectCell cell={cell} cellResponse={cellResponse} onUpdateValue={onUpdateValue} questionId={questionId} inputIdScope={inputIdScope} ariaInvalid={ariaInvalid} ariaDescribedBy={ariaDescribedBy} />;
    case 'input':
      return <InputCell cell={cell} cellResponse={cellResponse} onUpdateValue={onUpdateValue} questionId={questionId} inputIdScope={inputIdScope} ariaInvalid={ariaInvalid} ariaDescribedBy={ariaDescribedBy} gatingDisabled={gatingDisabled} />;
    case 'image':
      return <ImageCell cell={cell} cellResponse={cellResponse} onUpdateValue={onUpdateValue} questionId={questionId} />;
    case 'video':
      return <VideoCell cell={cell} cellResponse={cellResponse} onUpdateValue={onUpdateValue} questionId={questionId} />;
    case 'ranking':
      return <RankingCell cell={cell} cellResponse={cellResponse} onUpdateValue={onUpdateValue} questionId={questionId} inputIdScope={inputIdScope} ariaInvalid={ariaInvalid} ariaDescribedBy={ariaDescribedBy} />;
    case 'ranking_opt':
      return <RankingOptCell cell={cell} cellResponse={cellResponse} onUpdateValue={onUpdateValue} questionId={questionId} />;
    case 'calc':
      return <CalcCell cell={cell} questionId={questionId} />;
    case 'text':
    default:
      return <TextCell cell={cell} cellResponse={cellResponse} onUpdateValue={onUpdateValue} questionId={questionId} />;
  }
});

// ── 퍼블릭 컴포넌트: Zustand 구독 + 라우터 ──

interface InteractiveCellContainerProps {
  cell: TableCell;
  questionId: string;
  isTestMode: boolean;
  value?: Record<string, unknown> | undefined;
  onChange?: ((value: Record<string, unknown>) => void) | undefined;
  /**
   * Phase 5-D: 같은 행 + 같은 radioGroupName 셀들의 공통 HTML name 키.
   * 브라우저 native single-select 동작을 활성화한다 (시각적 처리).
   */
  groupName?: string | undefined;
  /**
   * Phase 5-D: 같은 그룹의 다른 셀 id 목록.
   * 이 셀이 응답될 때 sibling 셀들의 응답을 자동으로 빈값('')으로 클리어한다 (state 처리).
   */
  siblingCellIds?: string[] | undefined;
  inputIdScope?: string | undefined;
  ariaInvalid?: boolean | undefined;
  ariaDescribedBy?: string | undefined;
  /**
   * 셀 게이팅(CONTEXT.md "셀 게이팅") 평가용 — 같은 행의 셀 목록.
   * option 조건의 {optionId} 래핑 응답을 컨트롤러 셀 정의 기준으로 해석하려면 필요하다.
   * 미전달 시 isCellEnabled 가 flat 비교로 폴백해 오판정할 수 있다 — 호출처는 항상
   * row.cells 를 내려줘야 한다.
   */
  rowCells?: readonly TableCell[] | undefined;
}

export const InteractiveCell = React.memo(function InteractiveCell({
  cell,
  questionId,
  isTestMode,
  value,
  onChange,
  groupName,
  siblingCellIds,
  inputIdScope,
  ariaInvalid,
  ariaDescribedBy,
  rowCells,
}: InteractiveCellContainerProps) {
  const { cellResponse, updateValue, clearValue } = useCellResponse(
    questionId,
    cell.id,
    isTestMode,
    value,
    onChange,
    siblingCellIds,
  );

  // 게이팅 평가 — 같은 질문의 응답 객체가 필요하다. 실응답 모드는 value prop,
  // 테스트 모드는 스토어의 질문 레벨 객체를 구독한다.
  const testQuestionResponse = useTestResponseStore(
    useCallback(
      (state) => (isTestMode ? state.testResponses[questionId] : undefined),
      [isTestMode, questionId],
    ),
  );
  const rowValues = (isTestMode ? testQuestionResponse : value) ?? {};
  const gatingDisabled =
    cell.type === 'input' &&
    !isCellEnabled(
      cell,
      typeof rowValues === 'object' && !Array.isArray(rowValues)
        ? (rowValues as Record<string, unknown>)
        : {},
      rowCells,
    );

  // 비활성인데 값이 남아 있으면 즉시 지움 (컨트롤러 변경 직후 1회)
  useEffect(() => {
    if (gatingDisabled && cellResponse !== undefined && cellResponse !== '') {
      clearValue();
    }
  }, [gatingDisabled, cellResponse, clearValue]);

  return (
    <CellRouter
      cell={cell}
      cellResponse={cellResponse}
      onUpdateValue={updateValue}
      questionId={questionId}
      inputIdScope={inputIdScope}
      ariaInvalid={ariaInvalid}
      ariaDescribedBy={ariaDescribedBy}
      gatingDisabled={gatingDisabled}
      {...(groupName !== undefined ? { groupName } : {})}
    />
  );
});
