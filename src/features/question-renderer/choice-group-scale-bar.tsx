'use client';

import React, { useCallback, useMemo } from 'react';

import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { useChoiceGroupToggle } from '@/features/question-renderer/hooks/use-choice-opt-toggle';
import type {
  ScaleBarCell,
  ScaleBarModel,
} from '@/features/question-renderer/utils/choice-group-scale-bar';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { ChoiceGroup, TableCell } from '@/types/survey';

interface ChoiceGroupScaleBarProps {
  questionId: string;
  group: ChoiceGroup;
  /** projectScaleBar 가 돌려준 막대 모델 */
  model: ScaleBarModel;
  /** 섹션 제목 — 막대 머리 줄에 선택값 표시와 나란히 둔다. 비면 그룹 이름을 접근성 이름으로 쓴다 */
  label: string;
  /** 미충족 필수 그룹 — 머리 줄을 붉게 */
  invalid?: boolean | undefined;
  /** 이 그룹에서 고른 보기 칸 id — 없으면 고른 칸 없음 */
  selectedCellId: string | undefined;
  /**
   * 막대 칸(원래 보기 칸 id)을 눌렀을 때. 고르기·다시 누르면 풀기는 호출부 문항의 선택 쓰기
   * 규칙이다 — 표 문항은 TableChoiceGroupScaleBar, 보기 소스 표는 그 문항의 보기 선택 쓰기.
   */
  onToggleCell: (cellId: string) => void;
  /** 같은 문항이 여러 번 그려지는 자리에서 입력 id 가 겹치지 않게 */
  inputIdScope?: string | undefined;
}

/**
 * 척도 막대 — 척도 한 줄을 화면 폭에 맞춘 막대로 그린다(CONTEXT.md 「척도 막대」).
 *
 * 칸 글자는 원본 보기 칸 글자 그대로이고, 아래 구간 띠가 원본 헤더의 구간을 보여 준다. 구간 띠는
 * 구간을 구분만 하고 좋고 나쁨을 칠하지 않는다 — 척도가 양극이 아닐 수 있다(빈도·중요도). 두 회색
 * 톤을 교대로 칠하고 고른 칸의 구간만 강조색이다.
 *
 * 그리기만 한다. 판정(그릴지·무엇을 쓸지)은 투영이 끝냈고, 선택 읽기·쓰기는 호출부가 세로 타일과
 * 같은 채널로 넘긴다 — 응답 모양·저장·검증은 무변경이다. 표 문항(__choiceGroups)과 보기 소스 표
 * (그룹 맵)는 응답 모양이 달라 채널을 주입받는다.
 */
export const ChoiceGroupScaleBar = React.memo(function ChoiceGroupScaleBar({
  questionId,
  group,
  model,
  label,
  invalid,
  selectedCellId,
  onToggleCell,
  inputIdScope,
}: ChoiceGroupScaleBarProps) {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const text = (raw: string) => substituteTokens(raw, attrs, quotes);
  const count = model.cells.length;
  const selectedIndex = model.cells.findIndex((cell) => cell.cellId === selectedCellId);
  const selected = selectedIndex >= 0 ? model.cells[selectedIndex] : undefined;
  const selectedBand = selected?.bandIndex ?? null;
  const bandLabelOf = (cell: ScaleBarCell) =>
    cell.bandIndex === null ? '' : text(model.bands[cell.bandIndex]!.label);
  const columnsStyle = { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` };
  const { left, middle, right } = model.anchors;
  const hasAnchors = left !== undefined || middle !== undefined || right !== undefined;
  const idPrefix = inputIdScope ? `${inputIdScope}-` : '';

  return (
    <div data-testid={`choice-group-scale-bar-${group.id}`} className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        {label && (
          <p
            className={cn(
              'min-w-0 text-[13px] font-semibold',
              invalid ? 'text-red-600' : 'text-gray-600',
            )}
          >
            {label}
          </p>
        )}
        {model.showsSelectionLabel && selected && (
          <span
            data-testid="scale-bar-selection"
            className="ml-auto shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700"
          >
            {[text(selected.text), bandLabelOf(selected)].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <div role="radiogroup" aria-label={label || text(group.label)}>
        <div
          className="grid overflow-hidden rounded-lg border border-gray-300 bg-white"
          style={columnsStyle}
        >
          {model.cells.map((barCell, index) => (
            <ScaleBarCellControl
              key={barCell.cellId}
              inputId={`${idPrefix}${questionId}-${barCell.cellId}-bar`}
              inputName={`${idPrefix}${questionId}-${group.groupKey}-bar`}
              barText={text(barCell.text)}
              inCellLabel={barCell.inCellLabel ? text(barCell.inCellLabel) : undefined}
              bandLabel={bandLabelOf(barCell)}
              first={index === 0}
              checked={barCell.cellId === selectedCellId}
              onToggle={() => onToggleCell(barCell.cellId)}
            />
          ))}
        </div>
        {model.bands.length > 0 && (
          // 구간마다 띠 하나 — 구간 사이만 틈을 둬 여러 칸이 한 구간으로 묶인 것이 보이게 한다
          <div aria-hidden className="mt-1 grid gap-x-0.5" style={columnsStyle}>
            {model.bands.map((band, bandIndex) => (
              <div
                key={`${band.start}-${band.label}`}
                className={cn(
                  'h-1 rounded-full',
                  bandIndex === selectedBand
                    ? 'bg-blue-500'
                    : bandIndex % 2 === 0
                      ? 'bg-gray-200'
                      : 'bg-gray-300',
                )}
                style={{ gridColumn: `${band.start + 1} / span ${band.span}` }}
              />
            ))}
          </div>
        )}
        {hasAnchors && (
          // 라벨은 글자 길이가 아니라 막대 칸에 붙인다 — 왼쪽은 첫 칸에서 오른쪽으로, 오른쪽은 마지막
          // 칸에서 왼쪽으로 뻗고, 가운데는 그 칸 가운데에 둔다(양 끝 정렬이면 「보통」이 칸 사이로 밀린다).
          <div aria-hidden className="relative mt-1 h-4 text-[11px] leading-4 text-gray-500">
            {left !== undefined && (
              <span className="absolute left-0 whitespace-nowrap">{text(left)}</span>
            )}
            {middle !== undefined && (
              <span
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${((middle.index + 0.5) / count) * 100}%` }}
              >
                {text(middle.label)}
              </span>
            )}
            {right !== undefined && (
              <span className="absolute right-0 whitespace-nowrap">{text(right)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

interface ScaleBarCellControlProps {
  inputId: string;
  inputName: string;
  barText: string;
  /** 5칸 이하 칸 안 라벨 — 칸 글자 아래 줄 */
  inCellLabel?: string | undefined;
  bandLabel: string;
  first: boolean;
  checked: boolean;
  onToggle: () => void;
}

/** 막대 칸 하나 — 칸 전체가 탭 영역이고, 라디오는 스크린리더·키보드용으로 칸 안에 숨어 있다 */
function ScaleBarCellControl({
  inputId,
  inputName,
  barText,
  inCellLabel,
  bandLabel,
  first,
  checked,
  onToggle,
}: ScaleBarCellControlProps) {
  return (
    <label
      htmlFor={inputId}
      className={cn(
        // 그리드 칸은 한 줄에서 가장 높은 칸에 맞춰 늘어나므로 라벨이 두 줄로 감겨도 칸 높이가 같다
        'flex min-h-10 min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-center text-[13px] transition-colors select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-inset',
        !first && 'border-l border-gray-200',
        checked ? 'bg-blue-600 font-semibold text-white' : 'text-gray-700',
      )}
    >
      <input
        type="radio"
        id={inputId}
        name={inputName}
        // 같은 글자가 칸 안 라벨·구간 이름 양쪽에서 오면(한 칸짜리 구간) 한 번만 읽는다
        aria-label={[...new Set([barText, inCellLabel, bandLabel])].filter(Boolean).join(' ')}
        checked={checked}
        onChange={() => {}}
        onClick={onToggle}
        className="sr-only"
      />
      <span aria-hidden className="break-keep">
        {barText}
      </span>
      {inCellLabel && (
        <span aria-hidden className="text-[11px] leading-tight break-keep">
          {inCellLabel}
        </span>
      )}
    </label>
  );
}

interface TableChoiceGroupScaleBarProps
  extends Omit<ChoiceGroupScaleBarProps, 'selectedCellId' | 'onToggleCell'> {
  /** 막대 칸이 된 원래 보기 칸 — 단독 선택 규칙 판정에 셀 정의가 필요하다 */
  cells: readonly TableCell[];
  value?: Record<string, unknown> | undefined;
  onChange?: ((value: Record<string, unknown>) => void) | undefined;
}

/**
 * 표 문항(보기 그룹 표)의 척도 막대 — 선택 읽기·쓰기가 세로 타일(ChoiceOptCell)과 같은
 * useChoiceGroupToggle 이다. 저장은 표 응답 안 예약 키 `__choiceGroups[그룹키]`.
 */
export const TableChoiceGroupScaleBar = React.memo(function TableChoiceGroupScaleBar({
  cells,
  value,
  onChange,
  ...barProps
}: TableChoiceGroupScaleBarProps) {
  const { selection, toggle } = useChoiceGroupToggle({
    questionId: barProps.questionId,
    group: barProps.group,
    value,
    onChange,
  });
  const cellById = useMemo(() => new Map(cells.map((cell) => [cell.id, cell])), [cells]);
  const onToggleCell = useCallback(
    (cellId: string) => {
      const cell = cellById.get(cellId);
      if (cell) toggle(cell);
    },
    [cellById, toggle],
  );
  return (
    <ChoiceGroupScaleBar
      {...barProps}
      selectedCellId={typeof selection === 'string' ? selection : undefined}
      onToggleCell={onToggleCell}
    />
  );
});
