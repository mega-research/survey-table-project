import { resolveChoiceGroupSliderDirection } from '@/features/question-renderer/utils/choice-group-mobile-view';
import { projectRadioQuestionScaleSlider } from '@/features/question-renderer/utils/radio-option-scale-slider';
import {
  type UngroupedSelectionType,
  projectRowScaleSliders,
  resolveUngroupedSelectionType,
} from '@/features/question-renderer/utils/row-scale-bars';
import {
  SCALE_SLIDER_MAX_TICKS,
  SCALE_SLIDER_MIN_TICKS,
  type ScaleSliderFallbackReason,
} from '@/features/question-renderer/utils/scale-slider';
import {
  resolveChoiceTableQuestionSliderDirection,
  tableHasScaleSliderRow,
} from '@/features/question-renderer/utils/scale-slider-table-layout';
import type { ScaleSliderDirection } from '@/types/scale-slider';
import type { ChoiceGroup, HeaderCell, Question, TableColumn, TableRow } from '@/types/survey';
import { isChoiceTableSource } from '@/utils/choice-source';

import { collectScaleFallbackIssues, scaleRowLabelOf } from './scale-bar-diagnostics';

/**
 * 척도 슬라이더 폴백 진단 — 담당자가 「척도 슬라이더」를 켰는데 응답 화면이 조용히 원래 모양으로 그릴
 * 자리를 빌더에서 미리 알린다(CONTEXT.md 「척도 슬라이더」). 척도 막대 진단(scale-bar-diagnostics)과
 * 같은 방식이고 경고 상자도 같은 것을 쓴다.
 *
 * ── 배선과 규칙 ──
 * - **판정은 응답 화면과 같은 함수를 그대로 부른다.** 표는 행 배치의 슬라이더 판정(`projectRowScaleSliders`)
 *   과 표 배치 판정의 재료(`tableHasScaleSliderRow`), 보통 라디오 문항은 라디오 보기 투영
 *   (`projectRadioQuestionScaleSlider`)이다. 여기서 규칙을 다시 쓰면 경고와 화면이 갈린다.
 * - **표는 구조(저작한 행·열·헤더)로 본다** — 표 배치 판정과 같은 재료다. 빌더에는 응답값이 없어 표시
 *   조건으로 숨는 행·열은 보지 않는다.
 * - 슬라이더를 켜는 설정은 둘이고 표마다 하나만 읽힌다. 보기 그룹이 있는 표는 그룹의 보기 모양
 *   (`diagnoseChoiceGroupScaleSlider` — 보기 칸 편집), 보통 라디오 문항과 그룹 없는 보기 소스 표는 문항 설정
 *   (`diagnoseQuestionScaleSlider` — 문항 편집의 기본 탭)이다. 어느 표가 문항 설정을 읽는지는 응답 화면과
 *   같은 함수(`resolveChoiceTableQuestionSliderDirection`)가 정한다 — 그룹이 생겨 읽히지 않게 된 값은
 *   진단하지 않는다.
 * - **「그릴 수 있는 행이 없다」(`drawsNothing`)는 표 전체 기준이다.** 표 배치 판정이 그 값으로 「지금과 같다」를
 *   정하므로, 이 그룹은 전부 폴백이어도 다른 그룹이 그려지면 화면은 바뀐다.
 * - 이유 코드는 척도 막대와 같은 글자 일곱이지만 뜻이 조금 다르다(눈금 2~13 · 「평균에서 제외」는 눈금이
 *   아니다) — 문구는 따로 둔다. 보통 라디오 문항은 표 칸이 아니라 보기라 문구가 또 다르다.
 * - 문구에 이모지를 쓰지 않는다.
 */

/** 표의 폴백 이유별 안내 — 무엇을 고치면 슬라이더가 나오는지 알 수 있게 쓴다 */
export const SCALE_SLIDER_FALLBACK_MESSAGES: Readonly<Record<ScaleSliderFallbackReason, string>> = {
  'not-single-choice':
    '복수 선택(체크박스) 보기는 슬라이더로 그릴 수 없습니다. 척도 슬라이더는 하나만 고르는 보기 전용입니다.',
  'non-choice-cell': '보기 칸이 아닌 응답 칸(입력칸·계산칸 등)이 섞여 있습니다.',
  'non-contiguous':
    '눈금이 될 보기 칸이 한 줄에 이어져 있지 않습니다. 사이에 다른 칸이 끼었거나 「평균에서 제외」 보기가 눈금 사이에 놓였습니다 — 「평균에서 제외」 보기는 눈금 줄의 맨 앞이나 맨 뒤에 둡니다.',
  'cell-count': `눈금(「평균에서 제외」를 뺀 보기 칸)이 ${SCALE_SLIDER_MIN_TICKS}개보다 적거나 ${SCALE_SLIDER_MAX_TICKS}개보다 많습니다.`,
  'text-input': '「선택 시 텍스트 입력 받기」가 켜진 보기가 있습니다.',
  'exclusive-choice': '「단독 선택 보기」가 켜진 보기가 있습니다.',
  'missing-text':
    '글자가 없는 보기 칸이 있습니다. 보기 칸이나 그 열의 헤더에 번호·라벨을 적어 주세요.',
};

/** 라디오 보기 투영이 내는 이유 — 보기 목록에는 열이 없어 셋뿐이다 */
type RadioOptionSliderFallbackReason = Extract<
  ScaleSliderFallbackReason,
  'cell-count' | 'text-input' | 'missing-text'
>;

/** 보통 라디오 문항의 폴백 이유별 안내 — 표 칸이 아니라 보기 이야기다 */
export const RADIO_OPTION_SLIDER_FALLBACK_MESSAGES: Readonly<
  Record<RadioOptionSliderFallbackReason, string>
> = {
  'cell-count': `눈금이 되는 보기(「평균 제외」를 뺀 보기)가 ${SCALE_SLIDER_MIN_TICKS}개보다 적거나 ${SCALE_SLIDER_MAX_TICKS}개보다 많습니다.`,
  'text-input': '주관식 선택지(「기타」 포함)가 있습니다. 슬라이더에는 입력칸이 설 자리가 없습니다.',
  'missing-text': '라벨이 빈 보기가 있습니다.',
};

function isRadioOptionFallbackReason(
  reason: ScaleSliderFallbackReason,
): reason is RadioOptionSliderFallbackReason {
  return reason in RADIO_OPTION_SLIDER_FALLBACK_MESSAGES;
}

/** 라디오 보기 투영이 새 이유를 내게 되면 표의 문구로 떨어진다 — 빈 경고가 뜨지 않는다 */
function radioOptionFallbackMessage(reason: ScaleSliderFallbackReason): string {
  return isRadioOptionFallbackReason(reason)
    ? RADIO_OPTION_SLIDER_FALLBACK_MESSAGES[reason]
    : SCALE_SLIDER_FALLBACK_MESSAGES[reason];
}

/**
 * 보통 라디오 문항에서 좁은 화면의 타일 글자가 잘게 끊기기 시작하는 눈금 수. 라디오 보기에는 눈금 글자
 * (번호)가 없어 좁은 화면의 「번호 타일 + 이름 목록」이 서지 않고, 타일 한 장에 라벨이 통째로 들어간다.
 */
export const RADIO_SLIDER_CRAMPED_TILE_MIN_TICKS = 8;

export interface ScaleSliderIssue {
  reason: ScaleSliderFallbackReason;
  message: string;
  /** 폴백하는 행 — 행 이름, 없으면 첫 글자 칸, 그것도 없으면 「N행」. 보통 라디오 문항은 행이 없어 비어 있다 */
  rowLabels: string[];
}

/** 표 구조 — 응답 화면의 표 배치 판정(`tableHasScaleSliderRow`)과 같은 재료 */
export interface ScaleSliderTableInput {
  rows: readonly TableRow[];
  /** 저작한 열 — 행의 셀과 인덱스가 맞는다 */
  columns: readonly TableColumn[];
  headerGrid?: HeaderCell[][] | undefined;
  choiceGroups: readonly ChoiceGroup[];
  /** 그룹 없는 보기 칸의 선택 방식 — `resolveUngroupedSelectionType(문항 유형)` */
  ungroupedSelectionType: UngroupedSelectionType;
  /** 그룹 없는 묶음의 슬라이더 방향 — `resolveChoiceTableQuestionSliderDirection(문항)`. 표 문항은 넘기지 않는다 */
  ungroupedSliderDirection?: ScaleSliderDirection | null | undefined;
}

export interface TableScaleSliderDiagnosis {
  /** 슬라이더로 고른 묶음 중 못 그리는 행 — 이유별 */
  issues: ScaleSliderIssue[];
  /** 슬라이더가 하나라도 서는 행의 수 */
  sliderRowCount: number;
}

/**
 * 표의 슬라이더 묶음 전부를 행마다 본다. `onlyGroupId` 를 주면 폴백은 그 그룹 것만 모은다(서는 행의 수는
 * 표 전체다).
 */
export function diagnoseTableScaleSliders(
  input: ScaleSliderTableInput,
  onlyGroupId?: string,
): TableScaleSliderDiagnosis {
  const failures: Array<{ reason: ScaleSliderFallbackReason; rowLabel: string }> = [];
  let sliderRowCount = 0;
  input.rows.forEach((row, index) => {
    const { sliders, fallbacks } = projectRowScaleSliders({
      columns: input.columns,
      barHeaderGrid: input.headerGrid,
      row,
      choiceGroups: input.choiceGroups,
      ungroupedSelectionType: input.ungroupedSelectionType,
      ungroupedSliderDirection: input.ungroupedSliderDirection,
    });
    if (sliders.length > 0) sliderRowCount += 1;
    for (const fallback of fallbacks) {
      if (onlyGroupId !== undefined && fallback.group?.id !== onlyGroupId) continue;
      failures.push({ reason: fallback.reason, rowLabel: scaleRowLabelOf(row, index) });
    }
  });
  return {
    issues: collectScaleFallbackIssues(failures, SCALE_SLIDER_FALLBACK_MESSAGES),
    sliderRowCount,
  };
}

export interface TableScaleSliderSummary {
  /** 슬라이더를 켠 설정이 이 표에서 읽히는가 — 슬라이더 그룹이 있거나 문항 설정의 방향이 넘어왔다 */
  enabled: boolean;
  /** 슬라이더로 그려지는 행이 있는가 — 표 배치 판정의 재료(`tableHasScaleSliderRow`) 그대로 */
  hasSliderRow: boolean;
}

/** 표에 슬라이더가 켜져 있는지와 그려지는 행이 있는지 — 모바일 표시 방식 옆 안내가 읽는다 */
export function summarizeTableScaleSlider(input: ScaleSliderTableInput): TableScaleSliderSummary {
  const enabled =
    (input.ungroupedSliderDirection ?? null) !== null ||
    input.choiceGroups.some((group) => resolveChoiceGroupSliderDirection(group) !== null);
  return { enabled, hasSliderRow: enabled && tableHasScaleSliderRow(input) };
}

export interface ChoiceGroupScaleSliderDiagnosis {
  /** 이 그룹을 슬라이더로 못 그리는 행 — 이유별. 그 행의 그룹은 응답 화면에서 원본 표 조각으로 보인다 */
  issues: ScaleSliderIssue[];
  /** 이 표에 슬라이더로 그릴 수 있는 행이 하나도 없다 — 화면(표 배치)이 바뀌지 않는다 */
  drawsNothing: boolean;
}

export interface DiagnoseChoiceGroupScaleSliderInput extends ScaleSliderTableInput {
  /** 진단할 그룹 — `choiceGroups` 안의 그룹(편집 중인 값) */
  groupId: string;
}

/**
 * 보기 그룹 「척도 슬라이더」 진단 — 슬라이더를 고른 그룹이 아니면 문제도 없다(다른 모양은 그 모양이 의도다).
 */
export function diagnoseChoiceGroupScaleSlider(
  input: DiagnoseChoiceGroupScaleSliderInput,
): ChoiceGroupScaleSliderDiagnosis {
  const group = input.choiceGroups.find((candidate) => candidate.id === input.groupId);
  if (resolveChoiceGroupSliderDirection(group) === null) return { issues: [], drawsNothing: false };
  const { issues } = diagnoseTableScaleSliders(input, input.groupId);
  return { issues, drawsNothing: !tableHasScaleSliderRow(input) };
}

export interface QuestionScaleSliderDiagnosis {
  /**
   * 문항 설정이 읽히는 자리 — 보통 라디오 문항(보기 목록) · 그룹 없는 보기 소스 표. 꺼졌거나 읽히지 않는
   * 문항이면 null 이고 나머지 값은 전부 「문제 없음」이다.
   */
  target: 'radio-options' | 'choice-table' | null;
  issues: ScaleSliderIssue[];
  /** 슬라이더로 그릴 수 있는 것이 없다 — 화면이 바뀌지 않는다 */
  drawsNothing: boolean;
  /** 보통 라디오 문항의 눈금이 많아 좁은 화면에서 타일 글자가 잘게 끊긴다 */
  crampedNarrowTiles: boolean;
  /** 그룹 없는 표에서 슬라이더가 서는 행이 둘 이상이다 — 답은 문항에 하나라 한 행을 답하면 다른 행이 비워진다 */
  sharedAnswerRows: boolean;
}

const NOT_TARGET: QuestionScaleSliderDiagnosis = {
  target: null,
  issues: [],
  drawsNothing: false,
  crampedNarrowTiles: false,
  sharedAnswerRows: false,
};

/**
 * 문항 설정의 「척도 슬라이더로 그리기」 진단 — 편집 중인 문항(폼 값 + 스토어의 보기 그룹)을 넘긴다.
 * 명단 값이 없는 자리라 보기 라벨은 적힌 글자 그대로 판정한다.
 */
export function diagnoseQuestionScaleSlider(question: Question): QuestionScaleSliderDiagnosis {
  if (question.type !== 'radio') return NOT_TARGET;

  if (isChoiceTableSource(question)) {
    const direction = resolveChoiceTableQuestionSliderDirection(question);
    if (direction === null) return NOT_TARGET;
    const { issues, sliderRowCount } = diagnoseTableScaleSliders({
      rows: question.tableRowsData ?? [],
      columns: question.tableColumns ?? [],
      headerGrid: question.tableHeaderGrid ?? undefined,
      choiceGroups: question.choiceGroups ?? [],
      ungroupedSelectionType: resolveUngroupedSelectionType(question.type),
      ungroupedSliderDirection: direction,
    });
    return {
      target: 'choice-table',
      issues,
      drawsNothing: sliderRowCount === 0,
      crampedNarrowTiles: false,
      sharedAnswerRows: sliderRowCount >= 2,
    };
  }

  const projected = projectRadioQuestionScaleSlider(question);
  if (projected === null) return NOT_TARGET;
  if (projected.ok) {
    return {
      target: 'radio-options',
      issues: [],
      drawsNothing: false,
      crampedNarrowTiles: projected.model.ticks.length >= RADIO_SLIDER_CRAMPED_TILE_MIN_TICKS,
      sharedAnswerRows: false,
    };
  }
  return {
    target: 'radio-options',
    issues: [
      {
        reason: projected.reason,
        message: radioOptionFallbackMessage(projected.reason),
        rowLabels: [],
      },
    ],
    drawsNothing: true,
    crampedNarrowTiles: false,
    sharedAnswerRows: false,
  };
}
