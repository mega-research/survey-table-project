'use client';

import React, { useCallback, useMemo, useRef } from 'react';

import {
  useAnswerQuotes,
  useContactAttrs,
} from '@/features/question-renderer/contact-attrs-context';
import { useChoiceGroupToggle } from '@/features/question-renderer/hooks/use-choice-opt-toggle';
import {
  type ScaleBarBandTone,
  type ScaleBarCell,
  type ScaleBarModel,
  resolveScaleBarBandTones,
} from '@/features/question-renderer/utils/choice-group-scale-bar';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { cn } from '@/lib/utils';
import type { ChoiceGroup, TableCell } from '@/types/survey';

/** 구간 띠 색 — 붉은색·회색·파란색, 양끝 구간은 짙게. 고른 칸의 구간은 같은 색을 가장 짙게 */
const BAND_TONE_CLASS: Readonly<Record<ScaleBarBandTone['side'], [string, string, string]>> = {
  // [기본, 짙게(양끝), 고름]
  negative: ['bg-red-200', 'bg-red-400', 'bg-red-600'],
  neutral: ['bg-gray-300', 'bg-gray-300', 'bg-gray-600'],
  positive: ['bg-blue-200', 'bg-blue-400', 'bg-blue-600'],
};

function bandToneClass(tone: ScaleBarBandTone, selected: boolean): string {
  const [base, strong, picked] = BAND_TONE_CLASS[tone.side];
  if (selected) return picked;
  return tone.strong ? strong : base;
}

/** 막대 키보드 이동 — 칸 수만큼 옮기거나(양끝에서 반대편으로 돈다) 첫 칸·끝 칸으로 */
const SCALE_BAR_KEY_MOVES: Readonly<Record<string, number | 'first' | 'last'>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  Home: 'first',
  End: 'last',
};

interface ChoiceGroupScaleBarProps {
  questionId: string;
  /**
   * 문항 안에서 막대를 가르는 id — 보기 그룹 id, 그룹 없는 묶음(보기 소스 표의 문항 선택)은 행별
   * 척도 투영의 묶음 키. 입력 name 과 테스트 id 에 쓴다.
   */
  barId: string;
  /** projectScaleBar 가 돌려준 막대 모델 */
  model: ScaleBarModel;
  /** 섹션 제목 — 막대 머리 줄에 선택값 표시와 나란히 둔다. 비면 ariaLabel 을 접근성 이름으로 쓴다 */
  label: string;
  /** 제목을 보이지 않는 자리(행 제목이 위에 있는 행별 척도)의 막대 접근성 이름 — 그룹 이름·행 제목 */
  ariaLabel?: string | undefined;
  /** 미충족 필수 그룹 — 머리 줄을 붉게, 막대 묶음을 오류 상태(aria-invalid)로 */
  invalid?: boolean | undefined;
  /** 이 그룹에서 고른 보기 칸 id — 없으면 고른 칸 없음 */
  selectedCellId: string | undefined;
  /**
   * 막대 칸(원래 보기 칸 id)을 눌렀을 때. 고르기·다시 누르면 풀기는 호출부 문항의 선택 쓰기
   * 규칙이다 — 표 문항은 TableChoiceGroupScaleBar, 보기 소스 표는 그 문항의 보기 선택 쓰기.
   */
  onToggleCell: (cellId: string) => void;
  /**
   * 누를 수 없는 칸(원래 보기 칸 id) — 세로 타일이 비활성인 칸과 같은 판정을 호출부가 넘긴다
   * (보기 소스 표의 문항 최대 선택 수). 보기 칸은 셀 게이팅 대상이 아니라 게이팅은 여기 오지 않는다.
   */
  disabledCellIds?: ReadonlySet<string> | undefined;
  /** 같은 문항이 여러 번 그려지는 자리에서 입력 id 가 겹치지 않게 */
  inputIdScope?: string | undefined;
}

/**
 * 척도 막대 — 척도 한 줄을 화면 폭에 맞춘 막대로 그린다(CONTEXT.md 「척도 막대」).
 *
 * 칸 글자는 원본 보기 칸 글자 그대로이고, 아래 구간 띠가 원본 헤더의 구간을 보여 준다(헤더에 구간
 * 줄이 없으면 칸마다 띠 하나). 구간 띠는
 * 왼쪽 붉은색 · 가운데 회색 · 오른쪽 파란색이고 양끝 구간은 짙게, 고른 칸의 구간은 가장 짙게 칠한다
 * (resolveScaleBarBandTones). 막대 아래 양끝·가운데 라벨은 검정 글자다.
 *
 * 그리기만 한다. 판정(그릴지·무엇을 쓸지)은 투영이 끝냈고, 선택 읽기·쓰기는 호출부가 세로 타일과
 * 같은 채널로 넘긴다 — 응답 모양·저장·검증은 무변경이다. 표 문항(__choiceGroups)과 보기 소스 표
 * (그룹 맵)는 응답 모양이 달라 채널을 주입받는다.
 */
export const ChoiceGroupScaleBar = React.memo(function ChoiceGroupScaleBar({
  questionId,
  barId,
  model,
  label,
  ariaLabel,
  invalid,
  selectedCellId,
  onToggleCell,
  disabledCellIds,
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
  // 띠는 늘 그린다 — 헤더에 구간 줄이 없는 척도(칸마다 이름이 하나씩인 5점 등)는 칸마다 띠 하나다.
  // 구간 이름·선택값 표시는 여전히 헤더의 구간(model.bands)만 쓴다.
  const hasHeaderBands = model.bands.length > 0;
  const stripBands = hasHeaderBands
    ? model.bands
    : model.cells.map((_, index) => ({ label: '', start: index, span: 1 }));
  const selectedStrip = hasHeaderBands ? selectedBand : selectedIndex >= 0 ? selectedIndex : null;
  const bandTones = resolveScaleBarBandTones(stripBands, count);
  const hasAnchors = left !== undefined || middle !== undefined || right !== undefined;
  const idPrefix = inputIdScope ? `${inputIdScope}-` : '';
  const inputIdOf = (cellId: string) => `${idPrefix}${questionId}-${cellId}-bar`;
  const radioGroupRef = useRef<HTMLDivElement>(null);

  // 방향키로 칸을 옮기며 고른다 — 단일 선택 그룹의 표준 키보드 동작에 양끝 돌기·Home/End 를 더한다.
  // 브라우저 기본 이동은 돌지 않고 Home/End 도 없어 직접 맡는다. 칸 순서는 DOM 이 아니라 모델에서
  // 읽는다(입력 id 로 찾는다) — DOM 은 포커스를 옮길 때만 쓴다.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const move = SCALE_BAR_KEY_MOVES[event.key];
    if (move === undefined) return;
    const targetId = (event.target as HTMLElement).id;
    const from = model.cells.findIndex((cell) => inputIdOf(cell.cellId) === targetId);
    if (from < 0) return;
    // 비활성 칸은 건너뛴다 — 방향키로도 누를 수 없는 칸에 답이 써지면 안 된다
    const enabled = (index: number) => !disabledCellIds?.has(model.cells[index]!.cellId);
    const step = move === 'first' ? 1 : move === 'last' ? -1 : move;
    let to = move === 'first' ? 0 : move === 'last' ? count - 1 : (from + move + count) % count;
    for (let tried = 0; tried < count && !enabled(to); tried += 1) {
      to = (to + step + count) % count;
    }
    if (!enabled(to)) return;
    event.preventDefault();
    const next = model.cells[to]!.cellId;
    radioGroupRef.current
      ?.querySelector<HTMLInputElement>(`input[id="${CSS.escape(inputIdOf(next))}"]`)
      ?.focus();
    if (next !== selectedCellId) onToggleCell(next);
  };

  return (
    <div data-testid={`choice-group-scale-bar-${barId}`} className="space-y-1.5">
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
      <div
        ref={radioGroupRef}
        role="radiogroup"
        aria-label={label || text(ariaLabel ?? '')}
        // 「다음」 뒤 미충족 필수 그룹 — 섹션 테두리·머리 줄과 같은 판정. 문구는 문항 단위 안내가 낸다
        aria-invalid={invalid || undefined}
        onKeyDown={handleKeyDown}
      >
        <div
          className="grid overflow-hidden rounded-lg border border-gray-300 bg-white"
          style={columnsStyle}
        >
          {model.cells.map((barCell, index) => (
            <ScaleBarCellControl
              key={barCell.cellId}
              inputId={inputIdOf(barCell.cellId)}
              inputName={`${idPrefix}${questionId}-${barId}-bar`}
              barText={text(barCell.text)}
              inCellLabel={barCell.inCellLabel ? text(barCell.inCellLabel) : undefined}
              bandLabel={bandLabelOf(barCell)}
              first={index === 0}
              checked={barCell.cellId === selectedCellId}
              disabled={disabledCellIds?.has(barCell.cellId) ?? false}
              onToggle={() => onToggleCell(barCell.cellId)}
            />
          ))}
        </div>
        {
          // 구간마다 띠 하나 — 구간 사이만 틈을 둬 여러 칸이 한 구간으로 묶인 것이 보이게 한다
          <div
            aria-hidden
            data-testid="scale-bar-strip"
            className="mt-1 grid gap-x-0.5"
            style={columnsStyle}
          >
            {stripBands.map((band, bandIndex) => (
              <div
                key={`${band.start}-${band.label}`}
                className={cn(
                  'h-1 rounded-full',
                  bandToneClass(bandTones[bandIndex]!, bandIndex === selectedStrip),
                )}
                style={{ gridColumn: `${band.start + 1} / span ${band.span}` }}
              />
            ))}
          </div>
        }
        {hasAnchors && (
          // 라벨은 글자 길이가 아니라 막대 칸에 붙인다 — 왼쪽은 첫 칸에서 오른쪽으로, 오른쪽은 마지막
          // 칸에서 왼쪽으로 뻗고, 가운데는 그 칸 가운데에 둔다(양 끝 정렬이면 「보통」이 칸 사이로 밀린다).
          <div aria-hidden className="relative mt-1 h-4 text-[11px] leading-4 text-gray-900">
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
  disabled: boolean;
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
  disabled,
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
        disabled && 'cursor-default opacity-50',
      )}
    >
      <input
        type="radio"
        id={inputId}
        name={inputName}
        // 같은 글자가 칸 안 라벨·구간 이름 양쪽에서 오면(한 칸짜리 구간) 한 번만 읽는다
        aria-label={[...new Set([barText, inCellLabel, bandLabel])].filter(Boolean).join(' ')}
        checked={checked}
        disabled={disabled}
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

interface TableChoiceGroupScaleBarProps extends Omit<
  ChoiceGroupScaleBarProps,
  'barId' | 'selectedCellId' | 'onToggleCell'
> {
  group: ChoiceGroup;
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
  group,
  cells,
  value,
  onChange,
  ...barProps
}: TableChoiceGroupScaleBarProps) {
  const { selection, toggle } = useChoiceGroupToggle({
    questionId: barProps.questionId,
    group,
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
      barId={group.id}
      ariaLabel={barProps.ariaLabel ?? group.label}
      selectedCellId={typeof selection === 'string' ? selection : undefined}
      onToggleCell={onToggleCell}
    />
  );
});
