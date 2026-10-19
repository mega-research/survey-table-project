import type { CellEnableCondition, QuestionOption } from '@/types/survey';
import {
  INTERACTIVE_CELL_TYPES,
  inferSpssMeasure,
  inferSpssVarType,
} from '@/utils/table-cell-code-generator';

import type { CellFormState, ContentType } from './serialize-cell';

/**
 * 셀 편집 폼의 동작 — 입력 하나가 폼 필드 여럿을 함께 바꾸는 규칙 (순수 함수).
 *
 * 필드 하나만 바꾸는 입력은 setter 를 그대로 쓰고, 필드끼리 얽힌 규칙만 여기 둔다.
 * 「무엇이 저장되는가」(유형별 키·배타 모드 거르기)는 여기가 아니라 저장(buildUpdatedCell)이 정한다 —
 * 편집 중에는 되돌릴 수 있도록 값을 남겨 둔다.
 */

/** 이 셀 자리의 자동 발번 셀 코드·엑셀 라벨 (모달이 표 위치에서 계산한다) */
export interface CellAutoCodes {
  autoCellCode: string | undefined;
  autoExportLabel: string | undefined;
}

/**
 * 셀 유형 전환 — SPSS 타입·측정 수준, 순위형 기본값, 비어 있는 셀 코드·엑셀 라벨을 함께 맞춘다.
 * 순위형 기본 보기는 id 를 새로 발급해야 해서 호출측이 만들어 넘긴다(이 함수는 순수해야 한다).
 */
export function changeContentType(
  form: CellFormState,
  next: ContentType,
  ctx: CellAutoCodes & { defaultRankingOptions?: QuestionOption[] },
): CellFormState {
  const result: CellFormState = { ...form, contentType: next };

  if (INTERACTIVE_CELL_TYPES.has(next)) {
    // 입력형 — 사용자가 고른 값이 없을 때만 추론한다
    if (!result.spssVarType) result.spssVarType = inferSpssVarType(next);
    if (!result.spssMeasure) result.spssMeasure = inferSpssMeasure(next);
  } else {
    // 비입력 유형(ranking 포함)은 셀 단위 SPSS 필드를 쓰지 않는다
    result.spssVarType = undefined;
    result.spssMeasure = undefined;
  }

  if (next === 'ranking') {
    if (result.rankingOptions.length === 0 && ctx.defaultRankingOptions) {
      result.rankingOptions = ctx.defaultRankingOptions;
    }
    if (!result.rankingConfig) result.rankingConfig = { positions: 3 };
  }

  if (!result.cellCode && !result.isCustomCellCode && ctx.autoCellCode) {
    result.cellCode = ctx.autoCellCode;
  }
  if (!result.exportLabel && !result.isCustomExportLabel && ctx.autoExportLabel) {
    result.exportLabel = ctx.autoExportLabel;
  }
  return result;
}

/**
 * 게이팅 조건 바꾸기. 처음 켤 때 필수 체크가 있으면 「활성일 때 필수」로 옮긴다 —
 * 게이팅이 켜지면 필수 체크박스가 숨겨지므로 그 의도가 사라지지 않게 한다(셀 게이팅 스펙 5절).
 */
export function changeGatingCondition(
  form: CellFormState,
  condition: CellEnableCondition | undefined,
): CellFormState {
  const firstEnable = condition !== undefined && form.gatingCondition === undefined;
  return {
    ...form,
    gatingCondition: condition,
    ...(firstEnable && form.cellRequired ? { gatingRequiredWhenEnabled: true } : {}),
  };
}

/**
 * 「숫자만 입력」 켜고 끄기. 이번 편집에서 처음 켤 때만 초기값(0)을 함께 켠다 —
 * 사용자가 초기값을 끈 뒤 숫자 모드를 다시 켜도 강제로 켜지 않는다.
 */
export function toggleNumberMode(form: CellFormState, on: boolean): CellFormState {
  if (!on) return { ...form, inputType: 'text' };
  if (form.emptyDefaultAutoApplied) return { ...form, inputType: 'number' };
  return { ...form, inputType: 'number', emptyDefaultEnabled: true, emptyDefaultAutoApplied: true };
}

/** 셀 코드 직접 입력 — 자동값과 다르게 쓰면 수동 값으로 본다 */
export function editCellCode(
  form: CellFormState,
  value: string,
  autoCellCode: string | undefined,
): CellFormState {
  return { ...form, cellCode: value, isCustomCellCode: value !== '' && value !== autoCellCode };
}

/** 셀 코드를 자동값으로 되돌린다 */
export function resetCellCode(
  form: CellFormState,
  autoCellCode: string | undefined,
): CellFormState {
  return { ...form, cellCode: autoCellCode || '', isCustomCellCode: false };
}

/** 엑셀 라벨 직접 입력 — 자동값과 다르게 쓰면 수동 값으로 본다 */
export function editExportLabel(
  form: CellFormState,
  value: string,
  autoExportLabel: string | undefined,
): CellFormState {
  return {
    ...form,
    exportLabel: value,
    isCustomExportLabel: value !== '' && value !== autoExportLabel,
  };
}

/** 엑셀 라벨을 자동값으로 되돌린다 */
export function resetExportLabel(
  form: CellFormState,
  autoExportLabel: string | undefined,
): CellFormState {
  return { ...form, exportLabel: autoExportLabel || '', isCustomExportLabel: false };
}

/** 셀 병합 켜고 끄기 — 끄면 병합 수를 1로 되돌리고, 켤 때는 비어 있는 병합 수만 1로 채운다 */
export function toggleMerge(form: CellFormState, on: boolean): CellFormState {
  if (!on) return { ...form, isMergeEnabled: false, rowspan: 1, colspan: 1 };
  return {
    ...form,
    isMergeEnabled: true,
    rowspan: form.rowspan === '' ? 1 : form.rowspan,
    colspan: form.colspan === '' ? 1 : form.colspan,
  };
}
