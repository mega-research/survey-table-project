import {
  BranchRule,
  CheckboxOption,
  NumberFormat,
  QuestionOption,
  RadioOption,
  RankingConfig,
  TableCell,
} from '@/types/survey';

import { parseNumericInput } from './numeric-input';
import { INTERACTIVE_CELL_TYPES } from './table-cell-code-generator';

/**
 * 셀 편집 모달의 폼 상태.
 *
 * cell-content-modal 의 35개 useState 가 표현하던 편집값을 한 객체로 모은 형태.
 * (a) 초기값 (b) hydrate (c) cancel 롤백 (d) save 직렬화 가 모두 이 한 모양을 공유한다.
 */
export interface CellFormState {
  contentType: ContentType;
  textContent: string;
  imageUrl: string;
  videoUrl: string;
  checkboxOptions: CheckboxOption[];
  radioOptions: RadioOption[];
  radioGroupName: string;
  selectOptions: QuestionOption[];
  allowOtherOption: boolean;
  cellOptionsColumns: number | undefined;
  inputPlaceholder: string;
  inputMaxLength: number | '';
  inputDefaultValueTemplate: string;
  inputType: 'text' | 'number';
  emptyDefaultEnabled: boolean;
  emptyDefaultRaw: string;
  cellNumberFormat: NumberFormat | undefined;
  /** 필수 응답 셀 (REQUIRED_CELL_TYPES 공용 — TableCell.required 로 직렬화) */
  cellRequired: boolean;
  minSelections: number | undefined;
  maxSelections: number | undefined;
  rankingOptions: QuestionOption[];
  rankingConfig: RankingConfig | undefined;
  rankSuffixPattern: string;
  rankVarNames: string[];
  rankingLabel: string;
  cellSpssNumericCode: number | '';
  isOtherRankingCell: boolean;
  choiceLabel: string;
  choiceAllowTextInput: boolean;
  choiceBranchRule: BranchRule | undefined;
  /** 이 보기 옵션 셀이 속한 ChoiceGroup.id. 빈 문자열 = 미소속. */
  choiceGroupId: string;
  horizontalAlign: 'left' | 'center' | 'right';
  mobileDisplay: NonNullable<TableCell['mobileDisplay']>;
  verticalAlign: 'top' | 'middle' | 'bottom';
  textPosition: NonNullable<TableCell['textPosition']>;
  isMergeEnabled: boolean;
  rowspan: number | '';
  colspan: number | '';
  cellCode: string;
  isCustomCellCode: boolean;
  exportLabel: string;
  isCustomExportLabel: boolean;
  spssVarType: TableCell['spssVarType'];
  spssMeasure: TableCell['spssMeasure'];
}

/** 셀 내용 편집 탭의 콘텐츠 타입 (모달 Tabs value) */
export type ContentType =
  | 'text'
  | 'image'
  | 'video'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'input'
  | 'ranking'
  | 'ranking_opt'
  | 'choice_opt';

// textPosition 컨트롤을 표시할 셀 타입 — 텍스트 라벨과 입력/옵션 영역이 분리된 셀들만
export const TEXT_POSITION_CELL_TYPES = new Set<ContentType>([
  'input',
  'checkbox',
  'radio',
  'select',
  'ranking',
]);
export const MOBILE_DISPLAY_CELL_TYPES = new Set<TableCell['type']>(['text', 'image', 'video']);

/** 필수 응답(TableCell.required) 지정이 가능한 셀 타입 — "다음" 차단형 검증 대상 */
export const REQUIRED_CELL_TYPES = new Set<TableCell['type']>([
  'input',
  'radio',
  'checkbox',
  'select',
  'ranking',
]);
export const MOBILE_LABEL_CELL_TYPES = new Set<TableCell['type']>([
  'checkbox',
  'radio',
  'select',
  'input',
  'ranking',
  'ranking_opt',
  'choice_opt',
]);

/** 옵션 그룹 귀속이 가능한 셀 타입 */
export const GROUPABLE_CELL_TYPES = new Set<TableCell['type']>(['choice_opt', 'ranking_opt']);

/** cell.type → 모달 ContentType (undefined 면 'text' 로 폴백) */
export function narrowCellType(t: TableCell['type'] | undefined): ContentType {
  return !t ? 'text' : t;
}

/** TableCell → 초기 폼 상태 생성 */
export function cellToFormState(cell: TableCell): CellFormState {
  const contentType = narrowCellType(cell.type);
  return {
    contentType,
    textContent: cell.content || '',
    imageUrl: cell.imageUrl || '',
    videoUrl: cell.videoUrl || '',
    checkboxOptions: cell.checkboxOptions || [],
    radioOptions: cell.radioOptions || [],
    radioGroupName: cell.radioGroupName || '',
    selectOptions: cell.selectOptions || [],
    allowOtherOption: cell.allowOtherOption || false,
    cellOptionsColumns: cell.optionsColumns,
    inputPlaceholder: cell.placeholder || '',
    inputMaxLength: cell.inputMaxLength || '',
    inputDefaultValueTemplate: cell.defaultValueTemplate ?? '',
    inputType: cell.inputType ?? 'text',
    emptyDefaultEnabled: cell.emptyDefault !== undefined,
    emptyDefaultRaw: cell.emptyDefault !== undefined ? String(cell.emptyDefault) : '0',
    cellNumberFormat: cell.numberFormat,
    cellRequired: cell.required ?? false,
    minSelections: cell.minSelections,
    maxSelections: cell.maxSelections,
    rankingOptions: cell.rankingOptions || [],
    rankingConfig: cell.rankingConfig,
    rankSuffixPattern: cell.rankSuffixPattern || '',
    rankVarNames: cell.rankVarNames || [],
    rankingLabel: cell.rankingLabel || '',
    cellSpssNumericCode: cell.spssNumericCode ?? '',
    isOtherRankingCell: cell.isOtherRankingCell === true,
    choiceLabel: cell.choiceLabel || '',
    choiceAllowTextInput: cell.allowTextInput === true,
    choiceBranchRule: cell.branchRule,
    choiceGroupId: cell.choiceGroupId ?? '',
    horizontalAlign: cell.horizontalAlign || 'left',
    mobileDisplay: cell.mobileDisplay ?? (MOBILE_LABEL_CELL_TYPES.has(contentType) ? 'inline' : 'hidden'),
    verticalAlign: cell.verticalAlign || 'top',
    textPosition: cell.textPosition || 'top',
    isMergeEnabled:
      (cell.rowspan && cell.rowspan > 1) || (cell.colspan && cell.colspan > 1) || false,
    rowspan: cell.rowspan || 1,
    colspan: cell.colspan || 1,
    cellCode: cell.cellCode || '',
    isCustomCellCode: cell.isCustomCellCode ?? !!cell.cellCode,
    exportLabel: cell.exportLabel || '',
    isCustomExportLabel: cell.isCustomExportLabel ?? !!cell.exportLabel,
    spssVarType: cell.spssVarType,
    spssMeasure: cell.spssMeasure,
  };
}

/**
 * 폼 상태 + 원본 셀로부터 저장될 TableCell 을 직렬화한다 (순수 함수).
 *
 * optional 필드는 조건부 spread 로 처리해 exactOptionalPropertyTypes 를 준수한다.
 * (모달의 handleSave 에서 추출 — 동작은 1:1 동일)
 */
export function buildUpdatedCell(form: CellFormState, cell: TableCell): TableCell {
  const { contentType } = form;

  const rankVarNamesForSave = (() => {
    if (contentType !== 'ranking') return undefined;
    const positions = Math.max(1, form.rankingConfig?.positions ?? 3);
    const trimmed = form.rankVarNames.slice(0, positions).map((n) => n.trim());
    return trimmed.some((n) => n.length > 0) ? trimmed : undefined;
  })();

  // 폼이 책임지는 필드는 기존 셀에서 베이스 복사하지 않는다.
  // 값 비우기/기본값 복귀 시 cellBase 의 예전 값이 되살아나는 것을 막고,
  // 아래 조건부 저장 블록을 단일 source of truth 로 둔다.
  const {
    cellCode: _cellCode,
    isCustomCellCode: _isCustomCellCode,
    exportLabel: _exportLabel,
    isCustomExportLabel: _isCustomExportLabel,
    choiceGroupId: _choiceGroupId,
    spssVarType: _spssVarType,
    spssMeasure: _spssMeasure,
    spssNumericCode: _spssNumericCode,
    imageUrl: _imageUrl,
    videoUrl: _videoUrl,
    checkboxOptions: _checkboxOptions,
    radioOptions: _radioOptions,
    radioGroupName: _radioGroupName,
    selectOptions: _selectOptions,
    allowOtherOption: _allowOtherOption,
    optionsColumns: _optionsColumns,
    placeholder: _placeholder,
    inputMaxLength: _inputMaxLength,
    defaultValueTemplate: _defaultValueTemplate,
    inputType: _inputType,
    emptyDefault: _emptyDefault,
    numberFormat: _numberFormat,
    required: _required,
    minSelections: _minSelections,
    maxSelections: _maxSelections,
    rankingConfig: _rankingConfig,
    rankingOptions: _rankingOptions,
    rankSuffixPattern: _rankSuffixPattern,
    rankVarNames: _rankVarNames,
    rankingLabel: _rankingLabel,
    isOtherRankingCell: _isOtherRankingCell,
    choiceLabel: _choiceLabel,
    branchRule: _branchRule,
    allowTextInput: _allowTextInput,
    textInputPlaceholder: _textInputPlaceholder,
    rowspan: _rowspan,
    colspan: _colspan,
    horizontalAlign: _horizontalAlign,
    verticalAlign: _verticalAlign,
    textPosition: _textPosition,
    mobileDisplay: _mobileDisplay,
    ...cellBase
  } = cell;

  const updatedCell: TableCell = {
    ...cellBase,
    type: contentType,
    // 모든 타입에서 텍스트 내용 저장 (라디오/체크박스/셀렉트에서도 설명 텍스트 표시 가능)
    content: form.textContent || '',
    // optional 필드: 타입이 해당하지 않으면 키 자체를 제거(조건부 spread)
    ...(contentType === 'image' && form.imageUrl ? { imageUrl: form.imageUrl } : {}),
    ...(contentType === 'video' && form.videoUrl ? { videoUrl: form.videoUrl } : {}),
    ...(contentType === 'checkbox' ? { checkboxOptions: form.checkboxOptions } : {}),
    ...(contentType === 'radio'
      ? { radioOptions: form.radioOptions, radioGroupName: form.radioGroupName }
      : {}),
    ...(contentType === 'select' ? { selectOptions: form.selectOptions } : {}),
    ...(['checkbox', 'radio', 'select', 'ranking'].includes(contentType)
      ? {
          allowOtherOption: form.allowOtherOption,
          ...(form.cellOptionsColumns !== undefined
            ? { optionsColumns: form.cellOptionsColumns }
            : {}),
        }
      : {}),
    ...(contentType === 'input'
      ? {
          ...(form.inputPlaceholder ? { placeholder: form.inputPlaceholder } : {}),
          ...(typeof form.inputMaxLength === 'number'
            ? { inputMaxLength: form.inputMaxLength }
            : {}),
          ...(form.inputDefaultValueTemplate.trim().length > 0
            ? { defaultValueTemplate: form.inputDefaultValueTemplate.trim() }
            : {}),
          inputType: form.inputType,
          ...(form.inputType === 'number' && form.emptyDefaultEnabled
            ? { emptyDefault: parseNumericInput(form.emptyDefaultRaw) ?? 0 }
            : {}),
          ...(form.inputType === 'number' && form.cellNumberFormat
            ? { numberFormat: form.cellNumberFormat }
            : {}),
        }
      : {}),
    // 필수 응답 셀 — 인터랙티브 셀 공용 (미체크·비대상 타입은 키 자체 제거)
    ...(REQUIRED_CELL_TYPES.has(contentType) && form.cellRequired ? { required: true } : {}),
    // 체크박스 선택 개수 제한 (체크박스 타입 전용)
    ...(contentType === 'checkbox'
      ? {
          ...(form.minSelections !== undefined ? { minSelections: form.minSelections } : {}),
          ...(form.maxSelections !== undefined ? { maxSelections: form.maxSelections } : {}),
        }
      : {}),
    // 순위형 셀 (Case 3)
    ...(contentType === 'ranking'
      ? {
          rankingOptions: form.rankingOptions,
          ...(form.rankingConfig !== undefined ? { rankingConfig: form.rankingConfig } : {}),
          ...(form.rankSuffixPattern.trim().length > 0
            ? { rankSuffixPattern: form.rankSuffixPattern.trim() }
            : {}),
          ...(rankVarNamesForSave ? { rankVarNames: rankVarNamesForSave } : {}),
        }
      : {}),
    // 순위형 옵션 소스 셀 (Case 2)
    ...(contentType === 'ranking_opt' && form.rankingLabel.trim().length > 0
      ? { rankingLabel: form.rankingLabel.trim() }
      : {}),
    // ranking_opt 그룹 귀속. 빈 문자열이면 기존 셀의 choiceGroupId 를 후처리 delete 로 제거.
    ...(contentType === 'ranking_opt' && form.choiceGroupId ? { choiceGroupId: form.choiceGroupId } : {}),
    // ranking_opt / choice_opt 전용 spssNumericCode (Case 2/A SPSS 재-export 안정성)
    // isOther 모드면 numeric 변수가 system-missing 이라 spssNumericCode 는 의미 없음 → 강제 undefined.
    ...(((contentType === 'ranking_opt' && !form.isOtherRankingCell) ||
      contentType === 'choice_opt') &&
    typeof form.cellSpssNumericCode === 'number'
      ? { spssNumericCode: form.cellSpssNumericCode }
      : {}),
    // ranking_opt 셀을 질문-레벨 "기타" 엔트리로 사용할지 (타입 전환 시 키 자체 제거).
    ...(contentType === 'ranking_opt' && form.isOtherRankingCell
      ? { isOtherRankingCell: true }
      : {}),
    // 보기 옵션 소스 셀 (Case A)
    ...(contentType === 'choice_opt'
      ? {
          ...(form.choiceLabel.trim().length > 0 ? { choiceLabel: form.choiceLabel.trim() } : {}),
          ...(form.choiceAllowTextInput ? { allowTextInput: true } : {}),
          // 보기 옵션 소스 셀의 조건부 분기 규칙 (Case A). value 는 셀 id(=resolveChoiceOptions
          // 가 부여하는 옵션 value)로 강제해 응답 매칭이 일치하도록 한다.
          ...(form.choiceBranchRule
            ? { branchRule: { ...form.choiceBranchRule, value: cell.id } }
            : {}),
          // 그룹 귀속. 빈 문자열이면 기존 셀에 있던 choiceGroupId 도 제거된다.
          // (choice_opt block 이 cellBase spread 이후에 위치하므로 빈 값 시
          //  명시적으로 undefined 를 넣어 키를 덮어쓴다 — exactOptionalPropertyTypes 준수를 위해
          //  후처리 delete 방식 대신 아래 updatedCell 후처리를 사용한다.)
          ...(form.choiceGroupId ? { choiceGroupId: form.choiceGroupId } : {}),
        }
      : {}),
    // 셀 병합 속성 추가
    ...(form.isMergeEnabled && typeof form.rowspan === 'number' && form.rowspan > 1
      ? { rowspan: form.rowspan }
      : {}),
    ...(form.isMergeEnabled && typeof form.colspan === 'number' && form.colspan > 1
      ? { colspan: form.colspan }
      : {}),
    // 모바일 카드 표시 (text/image/video 셀만; 기본 'hidden' 은 저장 안 함)
    ...(MOBILE_DISPLAY_CELL_TYPES.has(contentType) && form.mobileDisplay !== 'hidden'
      ? { mobileDisplay: form.mobileDisplay }
      : {}),
    // 정렬 속성 추가
    ...(form.horizontalAlign !== 'left' ? { horizontalAlign: form.horizontalAlign } : {}),
    ...(form.verticalAlign !== 'top' ? { verticalAlign: form.verticalAlign } : {}),
    // 셀 텍스트 위치
    ...(TEXT_POSITION_CELL_TYPES.has(contentType) && form.textPosition !== 'top'
      ? { textPosition: form.textPosition }
      : {}),
    // 셀 코드 및 엑셀 라벨 추가
    ...(form.cellCode ? { cellCode: form.cellCode } : {}),
    ...(form.isCustomCellCode === false
      ? { isCustomCellCode: false }
      : form.isCustomCellCode
        ? { isCustomCellCode: form.isCustomCellCode }
        : {}),
    ...(form.exportLabel ? { exportLabel: form.exportLabel } : {}),
    ...(form.isCustomExportLabel === false
      ? { isCustomExportLabel: false }
      : form.isCustomExportLabel
        ? { isCustomExportLabel: form.isCustomExportLabel }
        : {}),
    // SPSS 변수 타입 / 측정 수준 (입력 셀만; 값이 있을 때만 키 추가)
    ...(INTERACTIVE_CELL_TYPES.has(contentType)
      ? {
          ...(form.spssVarType !== undefined ? { spssVarType: form.spssVarType } : {}),
          ...(form.spssMeasure !== undefined ? { spssMeasure: form.spssMeasure } : {}),
        }
      : {}),
  };

  // choice_opt 또는 ranking_opt 에서 그룹 해제(빈 문자열)를 선택했을 때,
  // cellBase spread 로 남아있을 수 있는 choiceGroupId 를 제거한다.
  // exactOptionalPropertyTypes 상 undefined 할당은 금지이므로 delete 사용.
  if (GROUPABLE_CELL_TYPES.has(contentType) && !form.choiceGroupId) {
    delete (updatedCell as Partial<TableCell>).choiceGroupId;
  }

  // 표시 셀(text/image/video): 기본 hidden 은 새 셀에는 저장하지 않는다. 다만 기존에
  // header/inline/collapsed/hidden 으로 명시 설정된 셀을 hidden 으로 바꾸는 경우는
  // "자동 카드 헤더 폴백도 숨김" 의도를 보존해야 한다.
  if (MOBILE_DISPLAY_CELL_TYPES.has(contentType) && form.mobileDisplay === 'hidden') {
    if (cell.mobileDisplay !== undefined) {
      updatedCell.mobileDisplay = 'hidden';
    } else {
      delete (updatedCell as Partial<TableCell>).mobileDisplay;
    }
  }
  // 인터랙티브 셀: mobileDisplay 는 모바일 카드의 엑셀라벨 표시 여부로만 해석한다.
  // 기본 표시(inline)는 저장하지 않고, 숨김만 명시 저장한다.
  if (MOBILE_LABEL_CELL_TYPES.has(contentType)) {
    if (form.mobileDisplay === 'hidden') {
      updatedCell.mobileDisplay = 'hidden';
    } else {
      delete (updatedCell as Partial<TableCell>).mobileDisplay;
    }
  }
  if (!MOBILE_DISPLAY_CELL_TYPES.has(contentType) && !MOBILE_LABEL_CELL_TYPES.has(contentType)) {
    delete (updatedCell as Partial<TableCell>).mobileDisplay;
  }

  // 정렬도 기본값으로 되돌릴 때 cellBase 의 이전 값이 남지 않도록 제거한다.
  if (form.horizontalAlign === 'left') {
    delete (updatedCell as Partial<TableCell>).horizontalAlign;
  }
  if (form.verticalAlign === 'top') {
    delete (updatedCell as Partial<TableCell>).verticalAlign;
  }
  if (!TEXT_POSITION_CELL_TYPES.has(contentType) || form.textPosition === 'top') {
    delete (updatedCell as Partial<TableCell>).textPosition;
  }

  return updatedCell;
}
