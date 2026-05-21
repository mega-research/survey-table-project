'use client';

import { useCallback } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { NumericComparison } from '@/types/survey';

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

export function NumericComparisonEditor({
  value,
  onChange,
  idPrefix,
}: NumericComparisonEditorProps) {
  const operator = value?.operator ?? '==';
  const literalValue =
    value?.comparand?.kind === 'literal' ? String(value.comparand.value) : '';

  const handleOperatorChange = useCallback(
    (newOp: NumericComparison['operator']) => {
      const num = parseFloat(literalValue);
      onChange({
        operator: newOp,
        comparand: { kind: 'literal', value: Number.isNaN(num) ? 0 : num },
      });
    },
    [literalValue, onChange],
  );

  const handleValueChange = useCallback(
    (raw: string) => {
      // 빈/부호만/소수점만 진행 중 상태 허용 (응답자 입력과 동일한 정규식 패턴)
      if (!/^-?\d*\.?\d*$/.test(raw)) return;
      if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
        // 진행 중 상태 — 임시로 0 저장. UI 입력칸은 빈/부호 그대로 유지됨.
        onChange({
          operator,
          comparand: { kind: 'literal', value: 0 },
        });
        return;
      }
      const num = parseFloat(raw);
      if (Number.isNaN(num)) return;
      onChange({
        operator,
        comparand: { kind: 'literal', value: num },
      });
    },
    [operator, onChange],
  );

  return (
    <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-3">
      <Label className="text-xs font-semibold tracking-wide text-blue-900">
        숫자 입력 셀 — 비교 조건
      </Label>
      <div className="flex items-stretch gap-2">
        <select
          id={`${idPrefix}-operator`}
          value={operator}
          onChange={(e) => handleOperatorChange(e.target.value as NumericComparison['operator'])}
          className="rounded-md border border-gray-300 bg-white p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          style={{ flex: '0 0 130px' }}
        >
          {OPERATOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <Input
          id={`${idPrefix}-value`}
          type="text"
          inputMode="decimal"
          value={literalValue}
          onChange={(e) => handleValueChange(e.target.value)}
          placeholder="숫자 입력"
          className="flex-1"
        />
      </div>
      <p className="text-xs text-slate-600">
        응답값이 위 숫자와 비교됩니다. 응답자는 셀에 숫자만 입력할 수 있습니다.
      </p>
    </div>
  );
}
