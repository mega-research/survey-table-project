'use client';

import { useCallback, useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  LeftOperand,
  NumericComparison,
  RightOperand,
} from '@/types/survey';
import { isPartialNumericInput, parseNumericInput } from '@/utils/numeric-input';

import { LeftOperandEditor } from './left-operand-editor';
import { LookupComparandEditor } from './lookup-comparand-editor';

interface NumericComparisonEditorProps {
  value?: NumericComparison;
  onChange: (value: NumericComparison) => void;
  idPrefix: string; // label htmlFor 충돌 방지 (외부에서 단일성 보장)
}

const OPERATOR_OPTIONS: Array<{ value: NumericComparison['operator']; label: string }> = [
  { value: '==', label: '같음 (=)' },
  { value: '!=', label: '다름 (≠)' },
  { value: '>=', label: '이상 (≥)' },
  { value: '<=', label: '이하 (≤)' },
  { value: '>', label: '초과 (>)' },
  { value: '<', label: '미만 (<)' },
];

const emptyCellLeft = (): LeftOperand => ({ kind: 'cell', questionId: '', cellId: '' });

/**
 * 기존 (comparand 기반) 데이터를 새 (right 기반) 모델로 마이그레이션해서 반환.
 * - right 있으면 그대로
 * - comparand 만 있으면 literal 로 변환
 * - 둘 다 없으면 literal 0
 */
function getRightOperand(value?: NumericComparison): RightOperand {
  if (value?.right) return value.right;
  if (value?.comparand) return { kind: 'literal', value: value.comparand.value };
  return { kind: 'literal', value: 0 };
}

function literalToRaw(right: RightOperand): string {
  return right.kind === 'literal' ? String(right.value) : '';
}

export function NumericComparisonEditor({
  value,
  onChange,
  idPrefix,
}: NumericComparisonEditorProps) {
  const operator = value?.operator ?? '==';
  const left: LeftOperand = value?.left ?? emptyCellLeft();
  const right: RightOperand = getRightOperand(value);

  // literal 입력 raw state — 부분 입력(`-`, `.`, `-.`) 보존용.
  // value prop 이 외부에서 바뀌면 raw 도 동기화.
  const [rawInput, setRawInput] = useState<string>(() => literalToRaw(right));

  useEffect(() => {
    if (right.kind !== 'literal') return;
    const synced = String(right.value);
    if (parseNumericInput(rawInput) !== right.value) {
      setRawInput(synced);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [right.kind, right.kind === 'literal' ? right.value : null]);

  // 새 모델로 emit 할 때는 항상 right 사용 + comparand 비움 (마이그레이션).
  const emit = useCallback(
    (patch: Partial<NumericComparison>) => {
      onChange({
        operator,
        left,
        right,
        ...patch,
        comparand: undefined,
      });
    },
    [operator, left, right, onChange],
  );

  const emitOperator = (newOp: NumericComparison['operator']) => {
    emit({ operator: newOp });
  };

  const emitLeft = (next: LeftOperand) => {
    emit({ left: next });
  };

  const handleRightKindChange = (kind: 'literal' | 'lookup') => {
    if (kind === right.kind) return;
    if (kind === 'literal') {
      const parsed = parseNumericInput(rawInput);
      emit({ right: { kind: 'literal', value: parsed ?? 0 } });
    } else {
      emit({ right: { kind: 'lookup', surveyLookupId: '', keyMapping: [], valueColumn: '' } });
    }
  };

  const handleLiteralChange = (raw: string) => {
    if (!isPartialNumericInput(raw)) return;
    setRawInput(raw);
    const parsed = parseNumericInput(raw);
    if (parsed !== null) {
      emit({ right: { kind: 'literal', value: parsed } });
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3">
      <Label className="text-xs font-semibold tracking-wide text-blue-900">
        숫자 비교 조건
      </Label>

      <div className="space-y-1">
        <Label className="text-xs text-slate-600">좌변 (응답값 또는 산술)</Label>
        <LeftOperandEditor value={left} onChange={emitLeft} />
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor={`${idPrefix}-operator`} className="text-xs text-slate-600">
          비교
        </Label>
        <select
          id={`${idPrefix}-operator`}
          value={operator}
          onChange={(e) => emitOperator(e.target.value as NumericComparison['operator'])}
          className="rounded-md border border-gray-300 bg-white p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          style={{ flex: '0 0 130px' }}
        >
          {OPERATOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-slate-600">우변</Label>
        <Tabs
          value={right.kind}
          onValueChange={(v) => handleRightKindChange(v as 'literal' | 'lookup')}
          className="mb-2"
        >
          <TabsList>
            <TabsTrigger value="literal">직접 입력 값</TabsTrigger>
            <TabsTrigger value="lookup">외부 데이터 룩업</TabsTrigger>
          </TabsList>
        </Tabs>

        {right.kind === 'literal' && (
          <Input
            id={`${idPrefix}-value`}
            type="text"
            inputMode="decimal"
            value={rawInput}
            onChange={(e) => handleLiteralChange(e.target.value)}
            placeholder="비교할 숫자"
            className="flex-1"
          />
        )}
        {right.kind === 'lookup' && (
          <LookupComparandEditor
            value={right}
            onChange={(r) => emit({ right: r })}
          />
        )}
      </div>

      <p className="text-xs text-slate-600">
        응답값(또는 셀 산술 결과)이 위 비교 대상과 비교됩니다.
      </p>
    </div>
  );
}
