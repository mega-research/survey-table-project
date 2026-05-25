'use client';

import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { NumericComparison, Question } from '@/types/survey';
import {
  type CellTypeKind,
  isValueComparableKind,
} from '@/utils/cell-type-detector';

import { NumericComparisonEditor } from './numeric-comparison-editor';
import { TableOptionSelector } from './table-option-selector';

export interface ValueComparisonState {
  expectedValues?: string[];
  numericComparison?: NumericComparison;
}

interface ValueComparisonExpanderProps {
  /** 선택된 행/열 셀의 분류 결과. 'mixed'/'text-input'/'unsupported' 면 펼치기 자체가 비활성. */
  kind: CellTypeKind;
  /** numeric 에디터의 label htmlFor 충돌 방지용 prefix. */
  idPrefix: string;
  /** TableOptionSelector 에 넘길 참조 질문. */
  sourceQuestion: Question | undefined;
  /** 검사 대상 행 ID 들. */
  rowIds: string[];
  /** 검사 대상 열 인덱스 (caller 가 outer 가드로 number 보장). */
  colIndex: number;
  /** 현재 비교 상태 — 둘 다 undefined 면 접힘. */
  comparison: ValueComparisonState;
  /** 비교 상태 변경 — 펼치기/접기/내부 편집 모두 이 콜백 한 곳을 통해. */
  onChange: (next: ValueComparisonState) => void;
  /** TableOptionSelector 의 multipleRows 플래그. */
  multipleRows: boolean;
  /** option 케이스 helpText. */
  helpText?: string;
}

const EMPTY_NUMERIC: NumericComparison = {
  operator: '==',
  comparand: { kind: 'literal', value: 0 },
};

export function ValueComparisonExpander({
  kind,
  idPrefix,
  sourceQuestion,
  rowIds,
  colIndex,
  comparison,
  onChange,
  multipleRows,
  helpText,
}: ValueComparisonExpanderProps) {
  const hasComparison =
    comparison.expectedValues !== undefined || comparison.numericComparison !== undefined;
  const disabled = !isValueComparableKind(kind);

  if (!hasComparison) {
    return (
      <div className="space-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            if (kind === 'option') {
              onChange({ expectedValues: [], numericComparison: undefined });
            } else if (kind === 'numeric-input') {
              onChange({ expectedValues: undefined, numericComparison: EMPTY_NUMERIC });
            }
          }}
        >
          <Plus className="mr-1 h-3 w-3" />
          값 비교 조건 추가
        </Button>
        {kind === 'mixed' && (
          <p className="text-xs text-amber-700">
            선택한 행들의 셀 타입이 달라 값 비교를 적용할 수 없습니다. 행 그룹을 나눠 별도 조건으로 만드세요.
          </p>
        )}
        {kind === 'text-input' && (
          <p className="text-xs text-slate-500">
            텍스트 일치 매칭은 다음 업데이트에서 제공됩니다. 지금은 응답 유무로만 검사합니다.
          </p>
        )}
        {kind === 'unsupported' && (
          <p className="text-xs text-slate-500">선택한 셀 타입은 값 비교를 지원하지 않습니다.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">값 비교 조건</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ expectedValues: undefined, numericComparison: undefined })}
          aria-label="값 비교 조건 해제"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {kind === 'numeric-input' ? (
        <NumericComparisonEditor
          idPrefix={idPrefix}
          value={comparison.numericComparison}
          onChange={(nc) =>
            onChange({ expectedValues: undefined, numericComparison: nc })
          }
        />
      ) : kind === 'option' && sourceQuestion ? (
        <TableOptionSelector
          question={sourceQuestion}
          rowIds={rowIds}
          colIndex={colIndex}
          expectedValues={comparison.expectedValues}
          onChange={(values) =>
            onChange({ expectedValues: values, numericComparison: undefined })
          }
          helpText={helpText}
          multipleRows={multipleRows}
        />
      ) : (
        <p className="text-xs text-amber-700">
          이 비교 조건은 더 이상 셀 타입과 일치하지 않습니다. [x] 로 해제하고 다시 추가해주세요.
        </p>
      )}
    </div>
  );
}
