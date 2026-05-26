'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type {
  NumericComparison,
  Question,
  RightOperand,
} from '@/types/survey';
import { formatCellLabel } from '@/utils/cell-label';
import { isPartialNumericInput, parseNumericInput } from '@/utils/numeric-input';

import { LookupComparandEditor } from './lookup-comparand-editor';

interface NumericComparisonEditorProps {
  value?: NumericComparison;
  onChange: (value: NumericComparison) => void;
  idPrefix: string;
  onMigrate?: () => void;
}

const OPERATOR_OPTIONS: Array<{ value: NumericComparison['operator']; label: string }> = [
  { value: '==', label: '같음 (=)' },
  { value: '!=', label: '다름 (≠)' },
  { value: '>=', label: '이상 (≥)' },
  { value: '<=', label: '이하 (≤)' },
  { value: '>', label: '초과 (>)' },
  { value: '<', label: '미만 (<)' },
];

function formatCellRef(
  cellRef: { questionId: string; cellId: string },
  questions: Question[],
): string {
  const q = questions.find((x) => x.id === cellRef.questionId);
  if (!q) return '(삭제된 셀)';
  for (const row of q.tableRowsData ?? []) {
    for (const cell of row.cells ?? []) {
      if (cell.id === cellRef.cellId) {
        return `${q.title} > ${formatCellLabel(cell)}`;
      }
    }
  }
  return '(삭제된 셀)';
}

function BinopReadonlyLabel({
  left,
  onMigrate,
}: {
  left: NonNullable<NumericComparison['left']>;
  onMigrate?: () => void;
}) {
  const questions = useSurveyBuilderStore((s) => s.currentSurvey.questions);

  let summary: string;
  if (left.kind === 'cell') {
    summary = formatCellRef(left, questions);
  } else {
    const leftLabel = formatCellRef(left.left, questions);
    const rightLabel =
      left.right.kind === 'literal'
        ? String(left.right.value)
        : formatCellRef(left.right, questions);
    summary = `${leftLabel} ${left.op} ${rightLabel}`;
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
      <p className="font-semibold text-amber-900">
        이전 버전 &lsquo;셀 산술&rsquo; 좌변 (편집 불가)
      </p>
      <p className="font-mono text-amber-800">{summary}</p>
      <p className="text-amber-700">
        다시 만들려면 위 [x] 버튼으로 비교 조건을 해제 후 다시 추가하세요. 깊은 산술이 필요하면 조건 타입을 &lsquo;장기 계산식&rsquo; 으로 바꾸세요.
      </p>
      {onMigrate && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (confirm('이 비교 조건을 장기 계산식으로 변환합니다. 진행할까요?')) {
              onMigrate();
            }
          }}
        >
          장기 계산식으로 변환
        </Button>
      )}
    </div>
  );
}

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
  onMigrate,
}: NumericComparisonEditorProps) {
  const operator = value?.operator ?? '==';
  const left = value?.left;
  const right: RightOperand = getRightOperand(value);

  const [rawInput, setRawInput] = useState<string>(() => literalToRaw(right));

  useEffect(() => {
    if (right.kind !== 'literal') return;
    const synced = String(right.value);
    if (parseNumericInput(rawInput) !== right.value) {
      setRawInput(synced);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [right.kind, right.kind === 'literal' ? right.value : null]);

  const emit = useCallback(
    (patch: Partial<NumericComparison>) => {
      const next: NumericComparison = {
        operator,
        left,
        right,
        ...patch,
        comparand: undefined,
      };
      onChange(next);
    },
    [operator, left, right, onChange],
  );

  const emitOperator = (newOp: NumericComparison['operator']) => {
    emit({ operator: newOp });
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

      {left !== undefined && <BinopReadonlyLabel left={left} onMigrate={onMigrate} />}

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
        선택된 셀의 응답값이 위 비교 대상과 비교됩니다.
      </p>
    </div>
  );
}
