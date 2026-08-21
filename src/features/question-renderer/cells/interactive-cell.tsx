'use client';

import React, { useCallback, useEffect } from 'react';

import {
  useQuestionResponseSelector,
  useResponseSources,
} from '@/features/question-renderer/response-sources';
import { GATABLE_CELL_TYPES, isCellEnabled } from '@/lib/survey/cell-gating';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { TableCell } from '@/types/survey';

import { CalcCell } from './calc-cell';
import { CellContentLayout } from './cell-content-layout';
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
}: InteractiveCellProps) {
  switch (cell.type) {
    case 'checkbox':
      return (
        <CheckboxCell
          cell={cell}
          cellResponse={cellResponse}
          onUpdateValue={onUpdateValue}
          questionId={questionId}
          inputIdScope={inputIdScope}
          ariaInvalid={ariaInvalid}
          ariaDescribedBy={ariaDescribedBy}
        />
      );
    case 'radio':
      return (
        <RadioCell
          cell={cell}
          cellResponse={cellResponse}
          onUpdateValue={onUpdateValue}
          questionId={questionId}
          inputIdScope={inputIdScope}
          ariaInvalid={ariaInvalid}
          ariaDescribedBy={ariaDescribedBy}
          {...(groupName !== undefined ? { groupName } : {})}
        />
      );
    case 'select':
      return (
        <SelectCell
          cell={cell}
          cellResponse={cellResponse}
          onUpdateValue={onUpdateValue}
          questionId={questionId}
          inputIdScope={inputIdScope}
          ariaInvalid={ariaInvalid}
          ariaDescribedBy={ariaDescribedBy}
        />
      );
    case 'input':
      return (
        <InputCell
          cell={cell}
          cellResponse={cellResponse}
          onUpdateValue={onUpdateValue}
          questionId={questionId}
          inputIdScope={inputIdScope}
          ariaInvalid={ariaInvalid}
          ariaDescribedBy={ariaDescribedBy}
        />
      );
    case 'image':
      return (
        <ImageCell
          cell={cell}
          cellResponse={cellResponse}
          onUpdateValue={onUpdateValue}
          questionId={questionId}
        />
      );
    case 'video':
      return (
        <VideoCell
          cell={cell}
          cellResponse={cellResponse}
          onUpdateValue={onUpdateValue}
          questionId={questionId}
        />
      );
    case 'ranking':
      return (
        <RankingCell
          cell={cell}
          cellResponse={cellResponse}
          onUpdateValue={onUpdateValue}
          questionId={questionId}
          inputIdScope={inputIdScope}
          ariaInvalid={ariaInvalid}
          ariaDescribedBy={ariaDescribedBy}
        />
      );
    case 'ranking_opt':
      return (
        <RankingOptCell
          cell={cell}
          cellResponse={cellResponse}
          onUpdateValue={onUpdateValue}
          questionId={questionId}
        />
      );
    case 'calc':
      return <CalcCell cell={cell} questionId={questionId} />;
    case 'text':
    default:
      return (
        <TextCell
          cell={cell}
          cellResponse={cellResponse}
          onUpdateValue={onUpdateValue}
          questionId={questionId}
        />
      );
  }
});

// ── 퍼블릭 컴포넌트: Zustand 구독 + 라우터 ──

interface InteractiveCellContainerProps {
  cell: TableCell;
  questionId: string;
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
  value,
  onChange,
  groupName,
  siblingCellIds,
  inputIdScope,
  ariaInvalid,
  ariaDescribedBy,
  rowCells,
}: InteractiveCellContainerProps) {
  // 게이팅 숨김 상태에서도 셀 텍스트(content)는 남기므로 치환 컨텍스트가 필요하다
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const { questionResponses: source } = useResponseSources();
  const { cellResponse, updateValue, clearValue } = useCellResponse(
    questionId,
    cell.id,
    value,
    onChange,
    siblingCellIds,
  );

  // 게이팅 평가에 실제로 필요한 값은 컨트롤러 셀 하나뿐이다(option 조건의 옵션 id/value
  // 해석은 정적 prop 인 rowCells 로 이미 처리). 여기서 질문 응답 객체 전체를
  // 구독하면, mergePatch 가 매 입력마다 만드는 새 참조 탓에 같은 표의
  // 모든 InteractiveCell(input 뿐 아니라 checkbox/radio/text 전 타입)이 셀 하나만 바뀌어도
  // 재렌더된다 — use-cell-response 의 selectCell 이 지키는 셀 단위 스칼라 구독 원칙을 여기서도
  // 지켜야 한다. enabledWhen 이 없는 셀(대다수)은 controllerCellId 가 undefined 라 구독
  // 자체가 항상 같은 값(undefined)을 반환해 재렌더를 유발하지 않는다.
  const controllerCellId =
    GATABLE_CELL_TYPES.has(cell.type) && cell.enabledWhen
      ? cell.enabledWhen.controllerCellId
      : undefined;

  const selectController = useCallback(
    (questionResponse: unknown) => {
      if (!controllerCellId) return undefined;
      if (typeof questionResponse === 'object' && questionResponse !== null) {
        return (questionResponse as Record<string, unknown>)[controllerCellId];
      }
      return undefined;
    },
    [controllerCellId],
  );
  const sourceControllerValue = useQuestionResponseSelector(source, questionId, selectController);

  // 주입 원본이 없으면(controlled 렌더) 상위에서 이미 질문 단위 value prop 으로 내려오므로
  // (재렌더 비용은 이 훅 밖 상위 컴포넌트 소관 — 이번 변경 범위 밖) 기존처럼 그대로 쓴다.
  const gatingCellValues: Record<string, unknown> = source
    ? controllerCellId
      ? { [controllerCellId]: sourceControllerValue }
      : {}
    : (value ?? {});

  const gatingDisabled =
    GATABLE_CELL_TYPES.has(cell.type) && !isCellEnabled(cell, gatingCellValues, rowCells);

  // 비활성인데 값이 남아 있으면 즉시 지움 (컨트롤러 변경 직후 1회).
  // 타입별 응답 형태를 포괄해 잔존 판정: checkbox 는 배열, ranking 은 객체/배열,
  // radio/select/input 은 문자열 — 빈 배열·빈 객체는 잔존값이 아니므로 재지움 루프를 막는다.
  const hasLeftoverValue = Array.isArray(cellResponse)
    ? cellResponse.length > 0
    : typeof cellResponse === 'object' && cellResponse !== null
      ? Object.keys(cellResponse).length > 0
      : cellResponse !== undefined && cellResponse !== '';
  useEffect(() => {
    if (gatingDisabled && hasLeftoverValue) {
      clearValue();
    }
  }, [gatingDisabled, hasLeftoverValue, clearValue]);

  // 게이팅 미충족 셀은 인터랙티브 컨트롤을 숨긴다 (회색 잠금 → 숨김, 2026-08-06 UX 결정).
  // 셀 텍스트(content)는 항목 설명이므로 남긴다 — 컨트롤만 사라져 빈 자리로 보인다.
  // 조건 충족 순간 컨트롤이 제자리에 나타나고, 값 지움 effect 는 위에서 이미 동작한다.
  // 재마운트 시 input 의 emptyDefault prefill 이 새로 실행되는 것도 의도된 동작
  // (활성화 시 재채움 — 스펙 §7).
  if (gatingDisabled) {
    return (
      <CellContentLayout
        content={substituteTokens(cell.content, attrs, quotes)}
        position={cell.textPosition}
        bold={cell.textBold}
        textColor={cell.textColor}
      >
        {null}
      </CellContentLayout>
    );
  }

  return (
    <CellRouter
      cell={cell}
      cellResponse={cellResponse}
      onUpdateValue={updateValue}
      questionId={questionId}
      inputIdScope={inputIdScope}
      ariaInvalid={ariaInvalid}
      ariaDescribedBy={ariaDescribedBy}
      {...(groupName !== undefined ? { groupName } : {})}
    />
  );
});
