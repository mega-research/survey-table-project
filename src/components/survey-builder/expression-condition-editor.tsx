'use client';

import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type {
  ExpressionClause,
  ExpressionComparison,
  ExpressionConditionConfig,
  ExpressionOperand,
} from '@/types/survey';

import { ExpressionOperandPicker } from './expression-operand-picker';

export const MAX_GROUP_DEPTH = 1;

interface ExpressionConditionEditorProps {
  config: ExpressionConditionConfig;
  onChange: (next: ExpressionConditionConfig) => void;
  currentGroupDepth?: number; // root = 0
  idPrefix?: string;
}

const COMPARISON_OPS: ExpressionComparison['op'][] = ['==', '!=', '>', '<', '>=', '<='];
const COMPARISON_OP_LABELS: Record<ExpressionComparison['op'], string> = {
  '==': '같음 (=)',
  '!=': '다름 (≠)',
  '>':  '초과 (>)',
  '<':  '미만 (<)',
  '>=': '이상 (≥)',
  '<=': '이하 (≤)',
};

function emptyOperand(): ExpressionOperand { return { kind: 'literal', value: 0 }; }
function emptyComparison(): ExpressionComparison {
  return { left: emptyOperand(), op: '==', right: emptyOperand() };
}

export function ExpressionConditionEditor({
  config, onChange, currentGroupDepth = 0, idPrefix = 'expr',
}: ExpressionConditionEditorProps) {
  const canAddGroup = currentGroupDepth < MAX_GROUP_DEPTH;

  const updateClause = (idx: number, next: ExpressionClause) => {
    const clauses = [...config.clauses];
    clauses[idx] = next;
    onChange({ ...config, clauses });
  };

  const deleteClause = (idx: number) => {
    const clauses = config.clauses.filter((_, i) => i !== idx);
    const joinOps = config.joinOps.filter((_, i) => i !== Math.max(0, idx - 1));
    onChange({ ...config, clauses, joinOps });
  };

  const updateJoinOp = (idx: number, op: 'AND' | 'OR') => {
    const joinOps = [...config.joinOps];
    joinOps[idx] = op;
    onChange({ ...config, joinOps });
  };

  const addComparison = () => {
    const clauses = [...config.clauses, { kind: 'comparison' as const, comparison: emptyComparison() }];
    const joinOps = config.clauses.length === 0
      ? config.joinOps
      : [...config.joinOps, 'AND' as const];
    onChange({ ...config, clauses, joinOps });
  };

  const addGroup = () => {
    if (!canAddGroup) return;
    const clauses = [...config.clauses, {
      kind: 'group' as const,
      group: { clauses: [], joinOps: [] },
    }];
    const joinOps = config.clauses.length === 0
      ? config.joinOps
      : [...config.joinOps, 'AND' as const];
    onChange({ ...config, clauses, joinOps });
  };

  return (
    <div className="space-y-3">
      {config.clauses.map((clause, idx) => (
        <div key={idx} className="space-y-2">
          {idx > 0 && (
            <Select
              value={config.joinOps[idx - 1] ?? 'AND'}
              onValueChange={(v) => updateJoinOp(idx - 1, v as 'AND' | 'OR')}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">AND</SelectItem>
                <SelectItem value="OR">OR</SelectItem>
              </SelectContent>
            </Select>
          )}

          {clause.kind === 'comparison' ? (
            <ComparisonClauseEditor
              comparison={clause.comparison}
              onChange={(c) => updateClause(idx, { kind: 'comparison', comparison: c })}
              onDelete={() => deleteClause(idx)}
              idPrefix={`${idPrefix}-${idx}`}
            />
          ) : (
            <GroupClauseEditor
              config={clause.group}
              onChange={(g) => updateClause(idx, { kind: 'group', group: g })}
              onDelete={() => deleteClause(idx)}
              currentGroupDepth={currentGroupDepth + 1}
              idPrefix={`${idPrefix}-g${idx}`}
            />
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addComparison}>
          <Plus className="mr-1 h-3 w-3" /> 조건 추가
        </Button>
        {canAddGroup && (
          <Button type="button" variant="outline" size="sm" onClick={addGroup}>
            <Plus className="mr-1 h-3 w-3" /> 그룹 추가
          </Button>
        )}
      </div>
    </div>
  );
}

const ARITH_OPS = ['+', '-', '*', '/'] as const;
const ARITH_OP_LABELS: Record<typeof ARITH_OPS[number], string> = {
  '+': '+',
  '-': '-',
  '*': '×',
  '/': '÷',
};

function InlineArithmeticOperand({
  value, onChange, idPrefix,
}: {
  value: ExpressionOperand;
  onChange: (next: ExpressionOperand) => void;
  idPrefix: string;
}) {
  const isBinop = value.kind === 'binop';
  const arithOp = isBinop ? value.op : 'none';

  const handleArithChange = (next: string) => {
    if (next === 'none') {
      // unwrap: binop.left 를 새 value 로
      if (isBinop) onChange(value.left);
      return;
    }
    const newOp = next as typeof ARITH_OPS[number];
    if (isBinop) {
      onChange({ ...value, op: newOp });
    } else {
      // wrap: 현재 value 를 binop.left 로, right 는 empty literal
      onChange({
        kind: 'binop',
        op: newOp,
        left: value,
        right: { kind: 'literal', value: 0 },
      });
    }
  };

  return (
    <div className="space-y-2">
      <ExpressionOperandPicker
        value={isBinop ? value.left : value}
        onChange={(next) => {
          if (isBinop) onChange({ ...value, left: next });
          else onChange(next);
        }}
        currentDepth={isBinop ? 1 : 0}
        idPrefix={`${idPrefix}-A`}
      />
      <div className="flex items-center gap-2">
        <Label className="text-xs text-slate-600">산술</Label>
        <Select value={arithOp} onValueChange={handleArithChange}>
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">없음</SelectItem>
            {ARITH_OPS.map((op) => (
              <SelectItem key={op} value={op}>{ARITH_OP_LABELS[op]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isBinop && (
        <ExpressionOperandPicker
          value={value.right}
          onChange={(next) => onChange({ ...value, right: next })}
          currentDepth={1}
          idPrefix={`${idPrefix}-B`}
        />
      )}
    </div>
  );
}

function ComparisonClauseEditor({
  comparison, onChange, onDelete, idPrefix,
}: {
  comparison: ExpressionComparison;
  onChange: (next: ExpressionComparison) => void;
  onDelete: () => void;
  idPrefix: string;
}) {
  return (
    <div className="space-y-2 rounded-md border border-slate-300 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">비교 조건</Label>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete} aria-label="조건 삭제">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div>
        <Label className="text-xs text-slate-600">좌변</Label>
        <InlineArithmeticOperand
          value={comparison.left}
          onChange={(left) => onChange({ ...comparison, left })}
          idPrefix={`${idPrefix}-L`}
        />
      </div>
      <div>
        <Label className="text-xs text-slate-600">비교</Label>
        <Select value={comparison.op} onValueChange={(v) =>
          onChange({ ...comparison, op: v as ExpressionComparison['op'] })
        }>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPARISON_OPS.map((op) => (
              <SelectItem key={op} value={op}>{COMPARISON_OP_LABELS[op]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-slate-600">우변</Label>
        <InlineArithmeticOperand
          value={comparison.right}
          onChange={(right) => onChange({ ...comparison, right })}
          idPrefix={`${idPrefix}-R`}
        />
      </div>
    </div>
  );
}

function GroupClauseEditor({
  config, onChange, onDelete, currentGroupDepth, idPrefix,
}: {
  config: ExpressionConditionConfig;
  onChange: (next: ExpressionConditionConfig) => void;
  onDelete: () => void;
  currentGroupDepth: number;
  idPrefix: string;
}) {
  return (
    <div className="space-y-2 rounded-md border-2 border-slate-300 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">( 그룹 )</Label>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete} aria-label="그룹 삭제">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ExpressionConditionEditor
        config={config}
        onChange={onChange}
        currentGroupDepth={currentGroupDepth}
        idPrefix={idPrefix}
      />
    </div>
  );
}
