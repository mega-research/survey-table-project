'use client';

/* eslint-disable jsx-a11y/role-supports-aria-props -- aria-invalid 전역 상태를 실제 검증 입력에 연결한다. */
import React, { useCallback, useMemo } from 'react';

import { OptionTextInputStack } from '@/components/survey-response/option-text-input-stack';
import { CellText, resolveCellTextHtml } from '@/components/survey/cell-text';
import { useQuestionResponseWriter } from '@/hooks/use-question-response-writer';
import { CHOICE_GROUPS_KEY, readTableChoiceGroups } from '@/lib/survey/choice-selection';
import { useAnswerQuotes, useContactAttrs } from '@/lib/survey/contact-attrs-context';
import {
  applyExclusiveSelection,
  applyTableExclusiveToGroups,
  collectExclusiveChoiceCellIds,
  collectTableExclusiveChoiceCellIds,
} from '@/lib/survey/exclusive-choice';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { ChoiceGroup, TableCell } from '@/types/survey';
import { getCellTextClassName, getCellTextStyle } from '@/utils/cell-style';
import { getHorizontalJustifyClass } from '@/utils/table-grid-utils';

import { useGatingTableCells } from './gating-table-cells-context';

interface ChoiceOptCellProps {
  cell: TableCell;
  questionId: string;
  /** 이 셀이 속한 그룹 — 키(응답 맵의 키)와 종류(radio/checkbox)를 준다 */
  group: ChoiceGroup;
  isTestMode: boolean;
  value?: Record<string, unknown> | undefined;
  onChange?: ((value: Record<string, unknown>) => void) | undefined;
  inputIdScope?: string | undefined;
  ariaInvalid?: boolean | undefined;
  ariaDescribedBy?: string | undefined;
}

/**
 * 보기 그룹 표의 보기 옵션 셀 — table 문항 안에서 radio/checkbox 컨트롤로 그려진다.
 *
 * 값은 셀 id 키가 아니라 표 응답 안 예약 키 `__choiceGroups[그룹키]` 에 산다(단일 그룹은
 * 셀 id 하나, 복수 그룹은 셀 id 배열). 쓰기는 질문 응답 쓰기 채널을 타되, 예약 키 아래 맵은
 * 상위 병합이 통째로 바꾸므로 최신 맵 위에 그룹 하나만 고쳐 넣는다.
 *
 * 레거시 보기 소스 표(radio/checkbox 문항)의 셀과 달리 문항 레벨 값이 없다 — 그쪽 컴포넌트를
 * 재사용하지 않는다.
 */
export const ChoiceOptCell = React.memo(function ChoiceOptCell({
  cell,
  questionId,
  group,
  isTestMode,
  value,
  onChange,
  inputIdScope,
  ariaInvalid,
  ariaDescribedBy,
}: ChoiceOptCellProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const mergePatch = useQuestionResponseWriter({ questionId, isTestMode, value, onChange });
  const groupKey = group.groupKey;

  // 테스트 모드는 이 그룹의 선택만 구독한다 — 질문 객체 전체를 구독하면 셀 하나 바뀔 때마다
  // 표 전체가 재렌더된다(use-cell-response 의 셀 단위 구독 원칙).
  const testSelection = useTestResponseStore(
    useCallback(
      (state) =>
        isTestMode
          ? readTableChoiceGroups(state.testResponses[questionId])[groupKey]
          : undefined,
      [isTestMode, questionId, groupKey],
    ),
  );
  const selection = isTestMode ? testSelection : readTableChoiceGroups(value)[groupKey];
  const isCheckbox = group.type === 'checkbox';
  const checked = isCheckbox
    ? Array.isArray(selection) && selection.includes(cell.id)
    : selection === cell.id;

  // 단독 선택 보기 판정 재료 — 같은 그룹의 보기 셀 중 exclusiveChoice 가 켜진 것. 다른 행의 셀이라
  // 표 전체 셀 공급자에서 받는다(게이팅과 같은 공급자 — 응답 표 호스트는 전부 그 아래 있다).
  // 공급자가 없는 자리(빌더 편집 화면)에서는 이 셀 자신만 판정한다 — 거기서는 보기 셀이
  // 컨트롤로 그려지지 않으므로 실제로 도달하지 않는다.
  const tableCells = useGatingTableCells();
  const exclusiveCellIds = useMemo(() => {
    const ids = collectExclusiveChoiceCellIds(tableCells ?? [], group.id);
    if (cell.exclusiveChoice === true) ids.add(cell.id);
    return ids;
  }, [cell.exclusiveChoice, cell.id, group.id, tableCells]);
  const isExclusiveCellId = useCallback(
    (id: string) => exclusiveCellIds.has(id),
    [exclusiveCellIds],
  );
  // 표 전체 범위 단독 보기 — 그룹을 가리지 않고 이 표의 모든 보기 셀에서 모은다
  const tableExclusiveIds = useMemo(() => {
    const ids = collectTableExclusiveChoiceCellIds(tableCells ?? []);
    if (cell.exclusiveChoice === true && cell.exclusiveScope === 'table') ids.add(cell.id);
    return ids;
  }, [cell.exclusiveChoice, cell.exclusiveScope, cell.id, tableCells]);

  const commit = useCallback(
    (next: string | string[] | undefined, pickedId?: string) => {
      const latest = isTestMode
        ? readTableChoiceGroups(useTestResponseStore.getState().testResponses[questionId])
        : readTableChoiceGroups(value);
      let map: Record<string, string | string[]> = { ...latest };
      if (next === undefined) delete map[groupKey];
      else map[groupKey] = next;
      // 고른 것이 있을 때만 표 전체 규칙을 돌린다 — 해제는 다른 그룹에 영향이 없다
      if (pickedId !== undefined) {
        map = applyTableExclusiveToGroups(map, groupKey, pickedId, tableExclusiveIds);
      }
      mergePatch({ [CHOICE_GROUPS_KEY]: map });
    },
    [groupKey, isTestMode, mergePatch, questionId, tableExclusiveIds, value],
  );

  const toggle = useCallback(() => {
    if (isCheckbox) {
      const current = Array.isArray(selection) ? (selection as string[]) : [];
      if (current.includes(cell.id)) commit(current.filter((id) => id !== cell.id));
      else commit(applyExclusiveSelection(current, cell.id, isExclusiveCellId).next, cell.id);
      return;
    }
    // 라디오는 고른 것을 다시 누르면 푼다 — 표 안 radio 셀과 같은 동작
    if (selection === cell.id) commit(undefined);
    else commit(cell.id, cell.id);
  }, [cell.id, commit, isCheckbox, isExclusiveCellId, selection]);

  const rawLabel = (cell.choiceLabel ?? '').trim() || cell.content || '';
  const label = substituteTokens(rawLabel, attrs, quotes);
  const inputId = `${inputIdScope ? `${inputIdScope}-` : ''}${questionId}-${cell.id}`;
  const controlCls =
    'mt-1 h-4 w-4 shrink-0 cursor-pointer border-gray-300 text-blue-600 focus:ring-blue-500';

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      {/* items-start + mt-1: 라벨이 두 줄로 감겨도 컨트롤이 첫 줄에 고정된다.
          가로 정렬은 이 행이 직접 — 뿌리가 w-full 이라 셀 래퍼의 items-* 가 닿지 않는다. */}
      <div
        className={cn('flex items-start gap-2', getHorizontalJustifyClass(cell.horizontalAlign))}
      >
        {isCheckbox ? (
          <input
            type="checkbox"
            id={inputId}
            aria-invalid={ariaInvalid || undefined}
            aria-describedby={ariaDescribedBy}
            checked={checked}
            onChange={toggle}
            className={cn(controlCls, 'rounded')}
          />
        ) : (
          <input
            type="radio"
            id={inputId}
            name={`${questionId}-${groupKey}`}
            aria-invalid={ariaInvalid || undefined}
            aria-describedby={ariaDescribedBy}
            checked={checked}
            onChange={() => {}}
            onClick={toggle}
            className={controlCls}
          />
        )}
        <label
          htmlFor={inputId}
          className={cn(
            'cursor-pointer text-base leading-relaxed whitespace-pre-line select-none [overflow-wrap:anywhere]',
            getCellTextClassName(cell),
          )}
          style={getCellTextStyle(cell)}
        >
          <CellText
            text={label}
            html={cell.choiceLabel ? undefined : resolveCellTextHtml(cell, attrs, quotes)}
            boldFirstLine={cell.boldFirstLine}
          />
        </label>
      </div>
      {/* 기타 상세기재 — 레거시 보기 소스 표와 같은 사이드카(보기 id) 입력칸. 고른 동안만 연다. */}
      {checked && cell.allowTextInput && (
        <OptionTextInputStack
          questionId={questionId}
          entries={[
            {
              option: {
                id: cell.id,
                ...(cell.textInputPlaceholder !== undefined
                  ? { textInputPlaceholder: cell.textInputPlaceholder }
                  : {}),
                ...(cell.textInputType !== undefined ? { textInputType: cell.textInputType } : {}),
                ...(cell.textInputNumberFormat !== undefined
                  ? { textInputNumberFormat: cell.textInputNumberFormat }
                  : {}),
              },
              label: label.trim() || '(라벨 없음)',
            },
          ]}
        />
      )}
    </div>
  );
});
