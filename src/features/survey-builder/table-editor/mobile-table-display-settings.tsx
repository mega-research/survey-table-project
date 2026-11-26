'use client';

import { useState } from 'react';

import { Check } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  formatItemCardBlockColumns,
  normalizeItemCardBlockColumns,
  parseItemCardBlockColumnsText,
} from '@/features/question-renderer/utils/item-card-blocks';
import {
  type ScaleSliderTableLayout,
  resolveScaleSliderTableLayout,
} from '@/features/question-renderer/utils/scale-slider-table-layout';
import type { MobilePieceIssue } from '@/features/survey-builder/lib/mobile-piece-diagnostics';
import type { ScaleBarIssue } from '@/features/survey-builder/lib/scale-bar-diagnostics';
import type { TableScaleSliderSummary } from '@/features/survey-builder/lib/scale-slider-diagnostics';
import { cn } from '@/lib/utils';
import type { MobileTableDisplayMode } from '@/types/mobile-table-display';
import {
  formatMobileDrilldownRepeatHeaderRange,
  parseMobileDrilldownRepeatHeaderText,
  resolveMobileDrilldownRepeatHeaderRange,
} from '@/utils/mobile-drilldown-repeat-header';
import {
  clampMobileDrilldownOmitLeadingColumns,
  isRowWiseMobileTableDisplayMode,
} from '@/utils/mobile-table-display-mode';

import { MobilePieceArrangementFields } from './mobile-piece-arrangement-fields';
import { ScaleBarIssueAlert } from './scale-bar-issue-alert';
import { ScaleSliderInfoNote } from './scale-slider-guidance';

interface MobileTableDisplaySettingsValue {
  mode: MobileTableDisplayMode;
  omitLeadingColumns: number;
  repeatHeaderStartRow: number | null;
  repeatHeaderEndRow: number | null;
  itemCardBlockColumns: number[] | null;
}

interface MobileTableDisplaySettingsProps {
  mode: MobileTableDisplayMode;
  omitLeadingColumns: number;
  columnCount: number;
  repeatHeaderStartRow?: number | null | undefined;
  repeatHeaderEndRow?: number | null | undefined;
  /** 「항목 단위 카드」 블록 시작 열(1부터). 비면 블록 없음 */
  itemCardBlockColumns?: readonly number[] | null | undefined;
  /** 열마다의 헤더 글자(작성 열 순서) — 적은 블록 시작 열이 어느 열인지 되짚어 보인다 */
  columnHeaderLabels?: readonly string[] | undefined;
  onChange: (value: MobileTableDisplaySettingsValue) => void;
  /** 문항 유형 — 행 단위 카드는 보기-소스 표(radio/checkbox)에서만 의미가 있어 그때만 노출 */
  questionType?: 'table' | 'radio' | 'checkbox' | undefined;
  /** 테이블 유형에 보기 그룹이 있는가 — 있으면 행 단위 그룹 카드를 테이블 유형에도 노출 */
  hasChoiceGroups?: boolean | undefined;
  /**
   * 「행별 척도」에서 막대로 못 그려 원본 표 조각으로 보일 행과 이유(diagnoseRowScaleBars) —
   * 그 모드를 골랐을 때만 경고로 보인다.
   */
  rowScaleBarIssues?: readonly ScaleBarIssue[] | undefined;
  /**
   * 이 표에 척도 슬라이더가 켜져 있는지와 그려지는 행이 있는지(summarizeTableScaleSlider). 켜져 있으면
   * 고른 표시 방식보다 슬라이더의 배치가 앞선다는 안내를 보이고, 행 단위 배치의 설정(앞쪽 열 제외 수 ·
   * 반복 헤더 범위)을 표시 방식과 무관하게 보인다. 표시 방식 선택은 막지 않는다. 없으면 지금 화면 그대로다.
   */
  scaleSlider?: TableScaleSliderSummary | undefined;
  /**
   * 조각 좌우 반전 · 조각 한 화면 칸 수 — 원본 행 상세 설정의 나머지 둘. `onPieceChange` 를 넘긴 호출자에게만
   * 입력 칸을 보인다(앞쪽 열 제외 수 · 반복 헤더 범위와 같은 자리, 같은 조건). 값은 `onChange` 와 따로 흐른다 —
   * 한쪽을 고칠 때 다른 쪽 값이 옛 값으로 다시 쓰이지 않게.
   */
  pieceReverseColumns?: boolean | undefined;
  pieceColumnsPerView?: number | null | undefined;
  /** 켰는데 적용되지 않는 행과 이유(diagnoseMobilePieceArrangement) */
  pieceIssues?: readonly MobilePieceIssue[] | undefined;
  onPieceChange?:
    | ((patch: { reverseColumns?: boolean; columnsPerView?: number | null }) => void)
    | undefined;
}

/**
 * 척도 슬라이더가 켜진 표의 배치 안내 — 응답 화면의 표 배치 판정(좁은 화면 기준) 결과마다 한 줄.
 * 넓은 화면은 그려지는 행이 있으면 언제나 행 단위 배치다.
 */
const SLIDER_LAYOUT_LEADS: Readonly<Record<ScaleSliderTableLayout, string>> = {
  'row-wise': '척도 슬라이더가 켜져 있어 웹과 모바일 모두 행 단위로 그려집니다.',
  'row-group-cards':
    '척도 슬라이더가 켜져 있어 모바일은 「행 단위 그룹 카드」 안에서, 웹은 행 단위로 그려집니다.',
  unchanged:
    '척도 슬라이더가 켜져 있지만 슬라이더로 그릴 수 있는 행이 없어 화면이 바뀌지 않습니다. 이유는 슬라이더를 켠 자리(보기 칸 편집의 보기 모양 · 문항 설정)의 경고에 있습니다.',
};

const OPTIONS: Array<{ value: MobileTableDisplayMode; label: string; description: string }> = [
  {
    value: 'auto',
    label: '자동 카드',
    description: '표 구조에 따라 카드 또는 드릴다운으로 표시합니다.',
  },
  {
    value: 'drilldown-original-row',
    label: '드릴다운 후 선택 행 원본',
    description: '항목을 고른 뒤 선택한 행만 원본 열 배치로 표시합니다.',
  },
  {
    value: 'row-wise-original',
    label: '행별 원본 문항',
    description: '각 응답 행을 원본 열 배치의 문항으로 만들어 한 화면에 세로로 표시합니다.',
  },
  {
    value: 'row-wise-scale',
    label: '행별 척도',
    description:
      '행별 원본 문항과 같이 행마다 문항을 세우고, 각 보기 그룹은 그룹 설정의 보기 모양(세로 타일 · 원본 한 줄 · 척도 막대 · 척도 슬라이더)대로 보여 줍니다 — 행 단위 그룹 카드와 같은 설정입니다. 척도 막대로 고른 그룹은 화면 폭에 맞춘 막대(칸 글자 + 헤더 구간)가 됩니다. 그룹이 없는 보기 소스 표는 보기 전체가 막대입니다. 11점 척도처럼 칸이 많아 가로로 넘치는 표에 맞습니다.',
  },
  {
    value: 'row-cards',
    label: '행 단위 카드',
    description:
      '행마다 카드 하나를 만들고 고정 헤더 아래에 열별 선택을 세로 타일로 둡니다. 행과 축을 바꾸지 않고 축 단위 카드와 같은 디자인으로 표시합니다.',
  },
  {
    value: 'row-group-cards',
    label: '행 단위 그룹 카드',
    description:
      '행마다 카드 하나를 만들고 그 안을 보기 그룹(축)별 섹션으로 나눕니다. 구분 셀은 제목과 설명으로 항상 보이고, 인지 여부·필요성·참여 의향처럼 행마다 여러 축을 하나씩 고르는 표에 맞습니다.',
  },
  {
    value: 'axis-cards',
    label: '축 단위 카드',
    description:
      '축마다 카드 하나를 만들고 그 안에 행을 나열합니다. 카드 제목은 열 헤더이고 화면 위에 고정되어 따라옵니다. 보기 소스 표는 보기 그룹이 축이고(현재 활용·활용 계획처럼 축마다 독립된 선택), 테이블 유형은 응답 칸이 놓인 열이 축입니다(2025년·2026년처럼 연도별로 같은 행을 채우는 입력 표).',
  },
  {
    value: 'item-cards',
    label: '항목 단위 카드',
    description:
      '글자 셀(라벨)마다 카드 하나를 만들고 다음 라벨 전까지의 입력 칸을 그 카드에 담습니다. 한 행에 「라벨 + 입력」이 여러 쌍 놓인 양식형 표에 맞습니다. 이어진 라벨은 상위 · 하위 제목이 되고, 세로 병합된 상위 라벨은 아래 행 카드에도 따라갑니다. 단위 · 주석처럼 제목이 아닌 글자 셀은 셀의 모바일 표시를 「숨김」(또는 「바로 표시」 · 「접기」로 카드 설명)으로 지정하세요.',
  },
  {
    value: 'original',
    label: '전체 원본 표',
    description: '모바일에서도 표 전체를 가로 스크롤로 표시합니다.',
  },
];

export function MobileTableDisplaySettings({
  mode,
  omitLeadingColumns,
  columnCount,
  repeatHeaderStartRow,
  repeatHeaderEndRow,
  itemCardBlockColumns,
  columnHeaderLabels,
  onChange,
  questionType,
  hasChoiceGroups = false,
  rowScaleBarIssues = [],
  scaleSlider,
  pieceReverseColumns = false,
  pieceColumnsPerView = null,
  pieceIssues,
  onPieceChange,
}: MobileTableDisplaySettingsProps) {
  const isChoiceSourceTable = questionType === 'radio' || questionType === 'checkbox';
  const visibleOptions = OPTIONS.filter((option) => {
    if (option.value === 'row-cards') return isChoiceSourceTable;
    // 행 단위 그룹 카드는 보기 그룹이 있는 테이블 유형도 그린다(interactive-table-response 이식)
    if (option.value === 'row-group-cards') {
      return isChoiceSourceTable || (questionType === 'table' && hasChoiceGroups);
    }
    // 축 단위 카드 — 보기 소스 표는 축(보기 그룹)이 있어야 세울 수 있다(그룹 없는 표는 자동 카드가
    // 같은 모양). 테이블 유형은 응답 칸이 놓인 열이 축이라 그룹 없이도 된다.
    if (option.value === 'axis-cards') {
      return questionType === 'table' || (isChoiceSourceTable && hasChoiceGroups);
    }
    // 항목 단위 카드는 입력 칸이 셀 값인 테이블 유형 전용 — 보기 소스 표의 보기는 문항 응답이다
    if (option.value === 'item-cards') return questionType === 'table';
    return true;
  });
  // 척도 슬라이더가 켜진 표 — 응답 화면과 같은 표 배치 판정으로 좁은 화면·넓은 화면의 배치를 읽는다.
  // 꺼진 표(재료 없음 · enabled 거짓)는 null 이라 아래 안내·입력 조건이 전부 지금 화면 그대로다.
  const sliderLayout =
    scaleSlider?.enabled === true
      ? resolveScaleSliderTableLayout({
          hasSliderRow: scaleSlider.hasSliderRow,
          narrow: true,
          mobileMode: mode,
        })
      : null;
  // 넓은 화면의 행 단위 배치는 고른 표시 방식과 무관하게 앞쪽 열 제외 수 · 반복 헤더 범위를 읽는다
  const sliderDrawsRowWiseOnWide =
    scaleSlider?.enabled === true &&
    resolveScaleSliderTableLayout({
      hasSliderRow: scaleSlider.hasSliderRow,
      narrow: false,
      mobileMode: mode,
    }) === 'row-wise';
  const normalizedCount = clampMobileDrilldownOmitLeadingColumns(omitLeadingColumns, columnCount);
  const committedRange = resolveMobileDrilldownRepeatHeaderRange({
    mobileDrilldownRepeatHeaderStartRow: repeatHeaderStartRow,
    mobileDrilldownRepeatHeaderEndRow: repeatHeaderEndRow,
  });
  const committedText = formatMobileDrilldownRepeatHeaderRange(committedRange);
  const [repeatHeaderDraft, setRepeatHeaderDraft] = useState(committedText);

  // 외부 값 변경 시 draft 동기화 — effect 대신 렌더 중 조정 패턴
  const [prevCommittedText, setPrevCommittedText] = useState(committedText);
  if (prevCommittedText !== committedText) {
    setPrevCommittedText(committedText);
    setRepeatHeaderDraft(committedText);
  }

  const committedBlockColumns = normalizeItemCardBlockColumns(itemCardBlockColumns, columnCount);
  const committedBlockText = formatItemCardBlockColumns(committedBlockColumns);
  const [blockDraft, setBlockDraft] = useState(committedBlockText);
  const [blockDraftInvalid, setBlockDraftInvalid] = useState(false);
  const [prevCommittedBlockText, setPrevCommittedBlockText] = useState(committedBlockText);
  if (prevCommittedBlockText !== committedBlockText) {
    setPrevCommittedBlockText(committedBlockText);
    setBlockDraft(committedBlockText);
    setBlockDraftInvalid(false);
  }

  const emit = (next: Partial<MobileTableDisplaySettingsValue>) =>
    onChange({
      mode,
      omitLeadingColumns: normalizedCount,
      repeatHeaderStartRow: committedRange?.startRow ?? null,
      repeatHeaderEndRow: committedRange?.endRow ?? null,
      itemCardBlockColumns: committedBlockColumns,
      ...next,
    });

  const commitBlockDraft = () => {
    const parsed = parseItemCardBlockColumnsText(blockDraft, columnCount);
    if (!parsed.ok) {
      setBlockDraftInvalid(true);
      return;
    }
    setBlockDraftInvalid(false);
    setBlockDraft(formatItemCardBlockColumns(parsed.value));
    emit({ itemCardBlockColumns: parsed.value });
  };

  const commitRepeatHeaderDraft = () => {
    const parsed = parseMobileDrilldownRepeatHeaderText(repeatHeaderDraft);
    if (!parsed.ok) {
      setRepeatHeaderDraft(committedText);
      return;
    }
    const nextText = formatMobileDrilldownRepeatHeaderRange(parsed.value);
    setRepeatHeaderDraft(nextText);
    emit({
      repeatHeaderStartRow: parsed.value?.startRow ?? null,
      repeatHeaderEndRow: parsed.value?.endRow ?? null,
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-4">
      <div>
        <div id="mobile-table-display-mode-label" className="text-sm font-medium">
          모바일 표시 방식
        </div>
        <p className="text-xs text-gray-500">
          원본 배치가 중요한 척도형 표의 모바일 탐색 방식을 선택합니다.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby="mobile-table-display-mode-label"
        className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
      >
        {visibleOptions.map((option) => {
          const selected = mode === option.value;

          return (
            <label
              key={option.value}
              className={cn(
                'cursor-pointer rounded-lg border p-3 text-left has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-2',
                selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white',
              )}
            >
              <input
                type="radio"
                name="mobile-table-display-mode"
                value={option.value}
                aria-label={option.label}
                checked={selected}
                onChange={() => emit({ mode: option.value })}
                className="sr-only"
              />
              <span className="block text-sm font-semibold text-gray-900">{option.label}</span>
              <span className="mt-1 block text-xs text-gray-500">{option.description}</span>
              <span
                aria-hidden="true"
                className="mt-2 inline-flex min-h-5 items-center gap-1 text-xs font-semibold text-blue-700"
              >
                {selected ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    선택됨
                  </>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {sliderLayout !== null ? (
        <div data-testid="scale-slider-layout-note" className="space-y-1">
          <ScaleSliderInfoNote>{SLIDER_LAYOUT_LEADS[sliderLayout]}</ScaleSliderInfoNote>
          {sliderLayout !== 'unchanged' ? (
            // pl-5 — 줄 글자가 위 안내 글자(아이콘 폭 + 간격)와 같은 자리에서 시작하고 점은 아이콘 아래에 선다
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-gray-600">
              {sliderLayout === 'row-wise' && mode !== 'row-wise-scale' ? (
                <li>
                  모바일은 고른 표시 방식 대신 「행별 척도」처럼 그려져, 슬라이더가 아닌 보기 그룹은
                  제 보기 모양(기본 세로 타일)으로 보입니다.
                </li>
              ) : null}
              <li>
                웹의 행 단위 배치에는 좌측 고정 열 · 화면 폭에 맞춰 표 줄이기 · 상세 기재 입력칸을 표
                아래에 · 머리글 입력칸이 적용되지 않고, 슬라이더가 아닌 보기 그룹은 원본 표 조각으로
                보입니다.
              </li>
            </ul>
          ) : null}
        </div>
      ) : null}
      {mode === 'row-wise-scale' ? (
        <ScaleBarIssueAlert
          title="척도 막대로 고른 그룹 중 막대로 그릴 수 없는 행이 있어 그 행에서는 원본 표 조각으로 보입니다."
          issues={rowScaleBarIssues}
        />
      ) : null}
      {mode === 'item-cards' ? (
        <div className="max-w-xl space-y-1.5">
          <Label htmlFor="mobile-item-card-block-columns">블록 시작 열</Label>
          <Input
            id="mobile-item-card-block-columns"
            type="text"
            inputMode="text"
            placeholder="예: 1, 5"
            aria-invalid={blockDraftInvalid}
            value={blockDraft}
            onChange={(event) => setBlockDraft(event.target.value)}
            onBlur={commitBlockDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitBlockDraft();
              }
            }}
          />
          {blockDraftInvalid ? (
            <p className="text-xs text-red-600">
              1부터 {columnCount}까지의 열 번호를 쉼표로 구분해 적어 주세요.
            </p>
          ) : null}
          {!blockDraftInvalid && committedBlockColumns ? (
            <ul className="space-y-0.5 text-xs text-gray-700">
              {committedBlockColumns.map((start, index) => (
                <li key={start}>
                  블록 {index + 1} — {start}열
                  {columnHeaderLabels?.[start - 1] ? ` 「${columnHeaderLabels[start - 1]}」` : ''}
                  부터
                </li>
              ))}
            </ul>
          ) : null}
          {blockDraftInvalid ? null : (
            <p className="text-xs text-gray-500">
              표 두 벌을 좌우로 붙인 표에서 각 표가 시작하는 열 번호를 적습니다(예: 1, 6 —
              들여쓰기용 빈 열도 한 열로 셉니다). 블록마다 항목을 끝까지 세운 뒤 다음 블록으로
              넘어가고, 블록 제목(시작 열의 헤더)과 계산 칸만 있는 합계 행이 머리로 화면 위에
              고정됩니다. 입력 칸 이름은 열 헤더를 씁니다. 비우면 행 순서 그대로입니다.
            </p>
          )}
        </div>
      ) : null}
      {mode === 'drilldown-original-row' ||
      isRowWiseMobileTableDisplayMode(mode) ||
      sliderDrawsRowWiseOnWide ? (
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          {sliderDrawsRowWiseOnWide ? (
            <p className="text-xs text-gray-600 sm:col-span-2">
              척도 슬라이더의 행 단위 배치(웹 포함)도 이 두 값을 읽습니다.
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="mobile-drilldown-omit-leading">상세에서 제외할 앞쪽 열 수</Label>
            <Input
              id="mobile-drilldown-omit-leading"
              type="number"
              min={0}
              max={Math.max(0, columnCount - 1)}
              value={normalizedCount}
              onChange={(event) =>
                emit({
                  omitLeadingColumns: clampMobileDrilldownOmitLeadingColumns(
                    Number(event.target.value),
                    columnCount,
                  ),
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mobile-drilldown-repeat-header">상세에서 반복할 헤더 행</Label>
            <Input
              id="mobile-drilldown-repeat-header"
              type="text"
              inputMode="text"
              value={repeatHeaderDraft}
              onChange={(event) => setRepeatHeaderDraft(event.target.value)}
              onBlur={commitRepeatHeaderDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRepeatHeaderDraft();
                }
              }}
            />
            <p className="text-xs text-gray-500">
              비우면 반복하지 않습니다. 0은 진짜 헤더이며, 3 또는 0-2처럼 입력합니다.
            </p>
          </div>
          {onPieceChange ? (
            <MobilePieceArrangementFields
              reverseColumns={pieceReverseColumns}
              columnsPerView={pieceColumnsPerView}
              issues={pieceIssues}
              onChange={onPieceChange}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
