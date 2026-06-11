'use client';

import { useMemo, type ReactNode } from 'react';

import { TablePreview } from '@/components/survey-builder/table-preview';
import { useMobileView } from '@/hooks/use-media-query';
import { useContactAttrs } from '@/lib/survey/contact-attrs-context';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import type { Question, TableCell } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import {
  isGroupedChoiceQuestion,
  getGroupKeyOfCell,
  type GroupedChoiceAnswer,
} from '@/utils/choice-group-helpers';
import { findMobileHeaderCell } from '@/utils/mobile-display-cells';

import { MobileOptionCard } from './mobile-card-shared';
import { OptionTextInput } from './option-text-input';

interface ChoiceTableResponseProps {
  question: Question;
  /**
   * radio: string | null (비그룹), GroupedChoiceAnswer (그룹별 선택)
   * checkbox: string[]
   */
  value: unknown;
  onChange: (value: string | string[] | GroupedChoiceAnswer | null) => void;
}

/**
 * 테이블 내장 radio/checkbox(Case A) 응답 렌더.
 * - 데스크톱: tableRowsData 의 choice_opt 셀만 인터랙티브 input 으로 바꾼 TablePreview
 * - 모바일: 행마다 MobileOptionCard (라벨 + 표시 셀 + 체크/라디오 컨트롤)
 * 응답은 일반 radio/checkbox shape(radio=cell.id | null, checkbox=cell.id[])로 저장한다.
 */
export function ChoiceTableResponse({ question, value, onChange }: ChoiceTableResponseProps) {
  const isCheckbox = question.type === 'checkbox';
  // 그룹별 선택 모드 여부 — radio + choiceGroups 1개 이상 정의된 경우만 true
  const isGrouped = !isCheckbox && isGroupedChoiceQuestion(question);
  const isMobile = useMobileView();
  const attrs = useContactAttrs();
  const options = useMemo(() => resolveChoiceOptions(question), [question]);
  const optionByValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );

  // checkbox: cell.id[] / 비그룹 radio: [선택 cellId] / 그룹별 radio: 맵에서 values 추출
  const selectedIds: string[] = useMemo(() => {
    if (isCheckbox) return Array.isArray(value) ? (value as string[]) : [];
    if (isGrouped) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      // GroupedChoiceAnswer 값은 string | string[] — isGrouped 분기는 현재 radio 그룹
      // 전제(string)이므로 string인 값만 추출한다. Task 4에서 checkbox 그룹 지원 시 확장.
      return Object.values(value as GroupedChoiceAnswer).filter(
        (v): v is string => typeof v === 'string' && v !== '',
      );
    }
    return typeof value === 'string' && value ? [value] : [];
  }, [isCheckbox, isGrouped, value]);

  const minSel = question.minSelections;
  const maxSel = question.maxSelections;
  const isMaxSelectionReached =
    isCheckbox && maxSel !== undefined && maxSel > 0 && selectedIds.length >= maxSel;

  const toggle = (cellId: string, checked: boolean) => {
    if (isGrouped) {
      // 그룹별 선택: 같은 그룹 내에서 교체, 재클릭 시 해제(키 삭제)
      const groupKey = getGroupKeyOfCell(question, cellId);
      const map = (value && typeof value === 'object' && !Array.isArray(value)
        ? (value as GroupedChoiceAnswer)
        : {}) as GroupedChoiceAnswer;
      if (map[groupKey] === cellId) {
        // 재클릭 해제 — 해당 키 삭제
        const { [groupKey]: _removed, ...rest } = map;
        onChange(rest as GroupedChoiceAnswer);
      } else {
        onChange({ ...map, [groupKey]: cellId });
      }
      return;
    }
    if (!isCheckbox) {
      onChange(checked ? cellId : null);
      return;
    }
    let next = selectedIds.slice();
    if (checked) {
      if (maxSel !== undefined && maxSel > 0 && next.length >= maxSel) return;
      next.push(cellId);
    } else {
      next = next.filter((id) => id !== cellId);
    }
    onChange(next);
  };

  const getChoiceCellState = (cell: TableCell) => {
    const checked = isGrouped
      ? // 그룹별 선택: 그룹 키의 현재 선택값이 이 셀인지 확인
        (value && typeof value === 'object' && !Array.isArray(value)
          ? (value as GroupedChoiceAnswer)[getGroupKeyOfCell(question, cell.id)] === cell.id
          : false)
      : selectedIds.includes(cell.id);
    return {
      checked,
      disabled: isMaxSelectionReached && !checked,
      option: optionByValue.get(cell.id),
    };
  };

  const renderCell = (cell: TableCell): ReactNode => {
    if (cell.type !== 'choice_opt' || cell.isHidden) return undefined;
    const { checked, disabled, option } = getChoiceCellState(cell);
    // 그룹별 선택 모드: radio name 을 그룹 키 단위로 분리해야 브라우저가 그룹 간 선택을 지우지 않는다.
    const inputName = isGrouped
      ? `${question.id}-${getGroupKeyOfCell(question, cell.id)}`
      : question.id;

    return (
      <div className="flex flex-col items-center gap-2">
        <input
          type={isCheckbox ? 'checkbox' : 'radio'}
          name={inputName}
          aria-label={option?.label ?? '선택'}
          checked={checked}
          disabled={disabled}
          // 그룹 모드 radio 재클릭(이미 선택된 셀) 은 onChange 가 발화하지 않으므로
          // onClick 에서 토글 해제 처리. 비그룹 radio 는 기존대로 해제 불가(onChange만).
          onClick={isGrouped ? () => toggle(cell.id, !checked) : undefined}
          onChange={!isGrouped || isCheckbox ? (e) => toggle(cell.id, e.target.checked) : undefined}
          className="h-4 w-4"
        />
        {option?.allowTextInput && checked && (
          <OptionTextInput questionId={question.id} option={option} className="w-full" />
        )}
      </div>
    );
  };

  const showCounter = isCheckbox && (minSel !== undefined || maxSel !== undefined);

  const counter = showCounter ? (
    <div className="flex items-center justify-end gap-2 text-sm">
      <span className="text-gray-600">
        {maxSel !== undefined && maxSel > 0
          ? `${selectedIds.length}/${maxSel}개 선택됨`
          : `${selectedIds.length}개 선택됨`}
      </span>
      {minSel !== undefined && minSel > 0 && selectedIds.length < minSel && (
        <span className="text-orange-600">최소 {minSel}개 이상 선택해주세요</span>
      )}
    </div>
  ) : null;

  if (isMobile) {
    return (
      <div className="space-y-2">
        {(question.tableRowsData ?? []).flatMap((row) =>
          row.cells
            .filter((c) => c.type === 'choice_opt' && !c.isHidden)
            .map((choiceCell) => {
              const { checked, disabled, option } = getChoiceCellState(choiceCell);
              // 카드 제목: 행에 'header' 로 지정된 text 셀이 있으면 그 내용을 제목으로 사용하고,
              // 없으면 선택지 라벨(choiceLabel > content)로 폴백한다. exportLabel 은 제목으로 쓰지 않는다.
              const headerCell = findMobileHeaderCell(row.cells);
              const headerText = headerCell ? (headerCell.content ?? '').trim() : '';
              const cardLabel = headerText
                ? substituteTokens(headerText, attrs)
                : (option?.label ?? '(라벨 없음)');
              // 그룹별 선택 모드: radio name 을 그룹 키 단위로 분리
              const mobileInputName = isGrouped
                ? `${question.id}-${getGroupKeyOfCell(question, choiceCell.id)}`
                : question.id;
              return (
                <MobileOptionCard
                  key={choiceCell.id}
                  label={cardLabel}
                  cells={row.cells}
                  selected={checked}
                  disabled={disabled}
                  onToggle={() => toggle(choiceCell.id, !checked)}
                  control={
                    <input
                      type={isCheckbox ? 'checkbox' : 'radio'}
                      name={mobileInputName}
                      aria-label={cardLabel}
                      checked={checked}
                      disabled={disabled}
                      // 그룹 모드 radio 만 onClick 토글 해제. 비그룹은 기존 onChange 경로 유지.
                      onClick={isGrouped ? () => toggle(choiceCell.id, !checked) : undefined}
                      onChange={!isGrouped || isCheckbox ? (e) => toggle(choiceCell.id, e.target.checked) : undefined}
                      className="h-5 w-5"
                    />
                  }
                  footer={
                    option?.allowTextInput && checked ? (
                      <OptionTextInput
                        questionId={question.id}
                        option={option}
                        className="w-full"
                      />
                    ) : null
                  }
                />
              );
            }),
        )}
        {counter}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <TablePreview
        {...(question.tableTitle !== undefined ? { tableTitle: question.tableTitle } : {})}
        {...(question.tableColumns !== undefined ? { columns: question.tableColumns } : {})}
        {...(question.tableRowsData !== undefined ? { rows: question.tableRowsData } : {})}
        {...(question.tableHeaderGrid !== undefined ? { tableHeaderGrid: question.tableHeaderGrid } : {})}
        {...(question.hideColumnLabels !== undefined ? { hideColumnLabels: question.hideColumnLabels } : {})}
        renderCell={renderCell}
      />
      {counter}
    </div>
  );
}
