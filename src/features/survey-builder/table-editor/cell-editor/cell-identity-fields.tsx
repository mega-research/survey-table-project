'use client';

import type { RefObject } from 'react';

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { VariableDef } from '@/components/ui/rich-text-editor/types';
import { Textarea } from '@/components/ui/textarea';
import { VariableButton } from '@/features/survey-builder/variable-button';
import type { TableCell } from '@/types/survey';

import type { CellFormState } from './utils/serialize-cell';

import { INTERACTIVE_CELL_TYPES } from '@/utils/table-cell-code-generator';

import {
  INPUT_TEXT_ALIGN_CELL_TYPES,
  TEXT_POSITION_CELL_TYPES,
} from './utils/serialize-cell';

import type { CellFormSetters, UseCellFormResult } from './hooks/use-cell-form';

const TEXT_POSITION_OPTIONS: Array<{
  value: NonNullable<TableCell['textPosition']>;
  icon: typeof ArrowUp;
  label: string;
}> = [
  { value: 'top', icon: ArrowUp, label: '위' },
  { value: 'bottom', icon: ArrowDown, label: '아래' },
  { value: 'left', icon: ArrowLeft, label: '왼쪽' },
  { value: 'right', icon: ArrowRight, label: '오른쪽' },
];

// 입력값 가로 정렬 — 'inherit' 은 미지정으로, 셀 정렬(horizontalAlign)을 따른다
const INPUT_TEXT_ALIGN_OPTIONS: Array<{
  value: CellFormState['inputTextAlign'];
  icon: typeof AlignLeft | null;
  label: string;
}> = [
  { value: 'inherit', icon: null, label: '셀 정렬 따름' },
  { value: 'left', icon: AlignLeft, label: '왼쪽' },
  { value: 'center', icon: AlignCenter, label: '가운데' },
  { value: 'right', icon: AlignRight, label: '오른쪽' },
];

interface CellIdentityFieldsProps {
  form: UseCellFormResult['form'];
  setters: CellFormSetters;
  cell: TableCell;
  /** 셀 텍스트 입력칸 — 변수 버튼이 커서 위치에 토큰을 꽂는다. */
  textContentRef: RefObject<HTMLTextAreaElement | null>;
  /** 사용자가 코드를 직접 쓰지 않았을 때 보여줄 자동 발번 값. */
  autoCellCode: string | undefined;
  autoExportLabel: string | undefined;
  variableCatalog: VariableDef[];
}

/**
 * cell-content-modal 상단 구획 — 셀 텍스트·정렬과 셀 코드/엑셀 라벨/SPSS 속성.
 * 상태는 모달이 그대로 들고 있고 이 컴포넌트는 표시만 한다.
 */
export function CellIdentityFields({
  form,
  setters,
  textContentRef,
  autoCellCode,
  autoExportLabel,
  variableCatalog,
}: CellIdentityFieldsProps) {
  const {
    contentType,
    textContent,
    textPosition,
    inputTextAlign,
    cellCode,
    isCustomCellCode,
    exportLabel,
    isCustomExportLabel,
    spssVarType,
    spssMeasure,
  } = form;
  const {
    setTextContent,
    setTextPosition,
    setInputTextAlign,
    setCellCode,
    setIsCustomCellCode,
    setExportLabel,
    setIsCustomExportLabel,
    setSpssVarType,
    setSpssMeasure,
  } = setters;

  return (
  <div className="space-y-4 py-4">
    <div className="space-y-2">
      <Label htmlFor="common-text-content">셀 텍스트 내용</Label>
      <div className="flex items-start gap-2">
        <Textarea
          id="common-text-content"
          ref={textContentRef}
          value={textContent}
          onChange={(e) => setTextContent(e.target.value)}
          placeholder="셀에 표시할 텍스트를 입력하세요 (모든 타입에서 표시됨)"
          rows={3}
          className="flex-1 resize-none"
        />
        {variableCatalog.length > 0 && (
          <VariableButton
            catalog={variableCatalog}
            inputRef={textContentRef}
            onChange={(v) => setTextContent(v)}
          />
        )}
      </div>
      {textContent && (
        <div className="rounded bg-gray-50 p-2 text-xs text-gray-500">
          미리보기: {textContent}
        </div>
      )}

      {TEXT_POSITION_CELL_TYPES.has(contentType) && (
        <div className="space-y-2 pt-1">
          <Label className="text-sm font-medium">텍스트 위치</Label>
          <div className="flex gap-2">
            {TEXT_POSITION_OPTIONS.map(({ value, icon: Icon, label }) => (
              <Button
                key={value}
                type="button"
                variant={textPosition === value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTextPosition(value)}
                className="flex-1"
              >
                <Icon className="mr-2 h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            왼쪽/오른쪽 선택 시 텍스트와 입력 영역이 한 줄에 배치되고 세로 가운데 정렬됩니다.
          </p>
        </div>
      )}

      {INPUT_TEXT_ALIGN_CELL_TYPES.has(contentType) && (
        <div className="space-y-2 pt-1">
          <Label className="text-sm font-medium">입력값 정렬</Label>
          <div className="flex gap-2">
            {INPUT_TEXT_ALIGN_OPTIONS.map(({ value, icon: Icon, label }) => (
              <Button
                key={value}
                type="button"
                variant={inputTextAlign === value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setInputTextAlign(value)}
                className="flex-1"
              >
                {Icon && <Icon className="mr-2 h-4 w-4" />}
                {label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            값이 칸 안에서 채워지는 방향입니다. 오른쪽을 고르면 숫자가 오른쪽 끝에 붙어
            자릿수를 비교하기 좋습니다.
          </p>
        </div>
      )}
    </div>

    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="cell-code">셀 코드</Label>
          <div className="flex items-center gap-1">
            <Input
              id="cell-code"
              value={cellCode}
              onChange={(e) => {
                const val = e.target.value;
                setCellCode(val);
                // 사용자가 자동생성값과 다르게 수정하면 커스텀으로 표시
                setIsCustomCellCode(val !== '' && val !== autoCellCode);
              }}
              placeholder={autoCellCode || '예: Q4-1_r1_c1'}
              className="h-9"
            />
            {isCustomCellCode && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setCellCode(autoCellCode || '');
                  setIsCustomCellCode(false);
                }}
                title="자동값으로 초기화"
                className="h-9 w-9 shrink-0"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          {autoCellCode && isCustomCellCode && (
            <p className="text-[10px] text-gray-400">자동: {autoCellCode}</p>
          )}
          {!cellCode &&
            (INTERACTIVE_CELL_TYPES.has(contentType) || contentType === 'ranking') && (
              <p className="text-[10px] text-amber-500">
                셀코드가 비어있으면 내보내기에서 제외됩니다.
              </p>
            )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="export-label">엑셀 라벨</Label>
          <div className="flex items-center gap-1">
            <Input
              id="export-label"
              value={exportLabel}
              onChange={(e) => {
                const val = e.target.value;
                setExportLabel(val);
                setIsCustomExportLabel(val !== '' && val !== autoExportLabel);
              }}
              placeholder={autoExportLabel || '예: 가구TV보유_TV종류_UHD'}
              className="h-9"
            />
            {isCustomExportLabel && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setExportLabel(autoExportLabel || '');
                  setIsCustomExportLabel(false);
                }}
                title="자동값으로 초기화"
                className="h-9 w-9 shrink-0"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          {autoExportLabel && isCustomExportLabel && (
            <p className="text-[10px] text-gray-400">자동: {autoExportLabel}</p>
          )}
        </div>
      </div>

      {/* SPSS 변수 타입 / 측정 수준 (입력 셀만 표시) */}
      {INTERACTIVE_CELL_TYPES.has(contentType) && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="cell-spss-var-type" className="text-xs">
              변수 타입
            </Label>
            <select
              id="cell-spss-var-type"
              value={spssVarType || ''}
              onChange={(e) =>
                setSpssVarType((e.target.value || undefined) as TableCell['spssVarType'])
              }
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="" disabled>
                선택
              </option>
              <option value="Numeric">Numeric</option>
              <option value="String">String</option>
              <option value="Date">Date</option>
              <option value="DateTime">DateTime</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cell-spss-measure" className="text-xs">
              측정 수준
            </Label>
            <select
              id="cell-spss-measure"
              value={spssMeasure || ''}
              onChange={(e) =>
                setSpssMeasure((e.target.value || undefined) as TableCell['spssMeasure'])
              }
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="" disabled>
                선택
              </option>
              <option value="Nominal">Nominal (명목)</option>
              <option value="Ordinal">Ordinal (순서)</option>
              <option value="Continuous">Continuous (척도)</option>
            </select>
          </div>
        </div>
      )}
    </div>
  </div>
  );
}
