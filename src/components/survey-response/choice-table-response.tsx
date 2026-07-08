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
  getGroupTypeOfCell,
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
  // 그룹별 선택 모드 여부 — radio 또는 checkbox 그룹이 1개 이상 정의된 경우 true.
  // isCheckbox 가드를 제거하여 checkbox 질문도 grouped 경로를 밟을 수 있게 한다.
  const isGrouped = isGroupedChoiceQuestion(question);
  const isMobile = useMobileView();
  const attrs = useContactAttrs();
  const options = useMemo(() => resolveChoiceOptions(question), [question]);
  const optionByValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );

  // checkbox: cell.id[] / 비그룹 radio: [선택 cellId] / 그룹별(radio+checkbox 혼재): 맵 values flat
  const selectedIds: string[] = useMemo(() => {
    if (!isGrouped && isCheckbox) return Array.isArray(value) ? (value as string[]) : [];
    if (isGrouped) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      // GroupedChoiceAnswer 값은 string(radio 그룹) | string[](checkbox 그룹).
      // flat()으로 두 종류를 통합하여 선택된 모든 cellId 를 추출한다.
      return Object.values(value as GroupedChoiceAnswer)
        .flatMap((v): string[] => {
          if (typeof v === 'string' && v !== '') return [v];
          if (Array.isArray(v)) return v.filter((s): s is string => typeof s === 'string');
          return [];
        });
    }
    return typeof value === 'string' && value ? [value] : [];
  }, [isCheckbox, isGrouped, value]);

  const minSel = question.minSelections;
  const maxSel = question.maxSelections;
  const isMaxSelectionReached =
    isCheckbox && maxSel !== undefined && maxSel > 0 && selectedIds.length >= maxSel;

  const toggle = (cellId: string, checked: boolean) => {
    if (isGrouped) {
      const groupKey = getGroupKeyOfCell(question, cellId);
      const cellType = getGroupTypeOfCell(question, cellId);
      const map = (value && typeof value === 'object' && !Array.isArray(value)
        ? (value as GroupedChoiceAnswer)
        : {}) as GroupedChoiceAnswer;

      if (cellType === 'checkbox') {
        // checkbox 그룹: 배열 push/filter. 빈 배열이 되면 키 삭제.
        const arr = Array.isArray(map[groupKey]) ? (map[groupKey] as string[]) : [];
        let next: string[];
        if (arr.includes(cellId)) {
          // 체크 해제
          next = arr.filter((id) => id !== cellId);
        } else {
          // 체크 추가
          next = [...arr, cellId];
        }
        if (next.length === 0) {
          const { [groupKey]: _removed, ...rest } = map;
          onChange(rest as GroupedChoiceAnswer);
        } else {
          onChange({ ...map, [groupKey]: next });
        }
        return;
      }

      // radio 그룹: 같은 그룹 내에서 교체, 재클릭 시 해제(키 삭제)
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
    let checked: boolean;
    if (isGrouped) {
      const map =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as GroupedChoiceAnswer)
          : {};
      const groupKey = getGroupKeyOfCell(question, cell.id);
      const cellType = getGroupTypeOfCell(question, cell.id);
      if (cellType === 'checkbox') {
        // checkbox 그룹: 맵 값이 배열이고 그 배열에 cellId 가 포함되어야 checked
        const arr = map[groupKey];
        checked = Array.isArray(arr) && arr.includes(cell.id);
      } else {
        // radio 그룹: 맵 값이 이 cellId 와 일치하면 checked
        checked = map[groupKey] === cell.id;
      }
    } else {
      checked = selectedIds.includes(cell.id);
    }
    return {
      checked,
      disabled: isMaxSelectionReached && !checked,
      option: optionByValue.get(cell.id),
    };
  };

  const renderCell = (cell: TableCell): ReactNode => {
    if (cell.type !== 'choice_opt' || cell.isHidden) return undefined;
    const { checked, disabled, option } = getChoiceCellState(cell);
    // 그룹별 선택 모드: name 을 그룹 키 단위로 분리해야 브라우저가 그룹 간 선택을 지우지 않는다.
    // checkbox 그룹은 name 이 동작에 영향 없지만 일관성을 위해 동일 패턴을 유지한다.
    const inputName = isGrouped
      ? `${question.id}-${getGroupKeyOfCell(question, cell.id)}`
      : question.id;

    // 셀이 속한 그룹의 type 결정. 비그룹 경로는 질문 type 그대로 사용.
    const cellType = isGrouped ? getGroupTypeOfCell(question, cell.id) : (isCheckbox ? 'checkbox' : 'radio');

    // 컨트롤 옆 라벨: choiceLabel > content. 비어 있으면(라벨이 다른 열에 있는 구성)
    // 컨트롤만 렌더한다. 토큰은 응답 컨텍스트(attrs)로 치환.
    const rawLabel = (cell.choiceLabel ?? '').trim() || (cell.content ?? '').trim();
    const labelText = rawLabel ? substituteTokens(rawLabel, attrs) : '';

    return (
      <div className="flex flex-col items-center gap-2">
        <label className="flex cursor-pointer items-center justify-center gap-2">
          <input
            type={cellType === 'checkbox' ? 'checkbox' : 'radio'}
            name={inputName}
            aria-label={option?.label ?? '선택'}
            checked={checked}
            disabled={disabled}
            // radio 셀: 그룹 모드에서 재클릭(이미 선택) 은 onChange 가 발화하지 않으므로
            //   onClick 에서 토글 해제. 비그룹 radio 는 기존대로 해제 불가(onChange만).
            // checkbox 셀: onChange 경로(native toggle). onClick 불필요.
            onClick={isGrouped && cellType === 'radio' ? () => toggle(cell.id, !checked) : undefined}
            onChange={
              !isGrouped || cellType === 'checkbox'
                ? (e) => toggle(cell.id, e.target.checked)
                : undefined
            }
            // 그룹 radio 는 onChange 대신 onClick 으로 토글하므로 controlled checked 경고를
            // 막기 위해 readOnly 를 명시한다(onClick 동작에는 영향 없음).
            readOnly={isGrouped && cellType === 'radio'}
            className="h-4 w-4"
          />
          {labelText && <span className="text-sm text-gray-800">{labelText}</span>}
        </label>
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
              // 그룹별 선택 모드: name 을 그룹 키 단위로 분리
              const mobileInputName = isGrouped
                ? `${question.id}-${getGroupKeyOfCell(question, choiceCell.id)}`
                : question.id;
              // 모바일도 셀별 group type 결정
              const mobileCellType = isGrouped
                ? getGroupTypeOfCell(question, choiceCell.id)
                : (isCheckbox ? 'checkbox' : 'radio');
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
                      type={mobileCellType === 'checkbox' ? 'checkbox' : 'radio'}
                      name={mobileInputName}
                      aria-label={cardLabel}
                      checked={checked}
                      disabled={disabled}
                      // radio 셀: 그룹 모드에서 재클릭 onClick 해제. checkbox 셀: onChange 경로.
                      onClick={isGrouped && mobileCellType === 'radio' ? () => toggle(choiceCell.id, !checked) : undefined}
                      onChange={
                        !isGrouped || mobileCellType === 'checkbox'
                          ? (e) => toggle(choiceCell.id, e.target.checked)
                          : undefined
                      }
                      // 그룹 radio: onClick 토글 — controlled checked 경고 방지용 readOnly
                      readOnly={isGrouped && mobileCellType === 'radio'}
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
