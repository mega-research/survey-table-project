'use client';

import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { CellRef, LeftOperand, Question } from '@/types/survey';
import { formatCellLabel } from '@/utils/cell-label';
import { isPartialNumericInput, parseNumericInput } from '@/utils/numeric-input';

interface Props {
  /**
   * 좌변. undefined 면 "응답값 그대로" — 부모 조건이 가리키는 셀의 응답값을 사용 (evaluateNumericComparisonV2 가 처리).
   * binop 객체면 다른 셀들로 산술 계산.
   * 옛 단일 cell 변종은 evaluate 로직이 backward-compat 하지만 UI 에서는 새로 만들지 않음.
   */
  value: LeftOperand | undefined;
  onChange: (next: LeftOperand | undefined) => void;
  /** 좌변 산술 picker 의 옵션을 이 question 의 셀만 우선 노출하려면 지정 (현재는 모든 input 셀 노출) */
  sourceQuestionId?: string;
}

interface CellOption {
  label: string;
  cellRef: CellRef;
}

function collectInputCells(questions: Question[], preferredQuestionId?: string): CellOption[] {
  const out: CellOption[] = [];
  // 먼저 preferredQuestionId 의 셀을 위로, 그 다음 다른 질문 셀
  const orderedQuestions = preferredQuestionId
    ? [
        ...questions.filter((q) => q.id === preferredQuestionId),
        ...questions.filter((q) => q.id !== preferredQuestionId),
      ]
    : questions;
  for (const q of orderedQuestions) {
    if (q.type !== 'table' || !q.tableRowsData) continue;
    for (const row of q.tableRowsData) {
      for (const c of row.cells ?? []) {
        if (c.type !== 'input') continue;
        // 가로/세로 병합으로 가려진 후속 셀 제외 — 머지 영역의 첫 셀만 노출
        if (c.isHidden) continue;
        out.push({
          label: `${q.title} > ${formatCellLabel(c)}`,
          cellRef: { kind: 'cell', questionId: q.id, cellId: c.id },
        });
      }
    }
  }
  return out;
}

const emptyCellRef = (): CellRef => ({ kind: 'cell', questionId: '', cellId: '' });

export function LeftOperandEditor({ value, onChange, sourceQuestionId }: Props) {
  const questions = useSurveyBuilderStore((s) => s.currentSurvey.questions);
  // 큰 설문일수록 input 셀 집계가 비싸므로 questions / sourceQuestionId 변화 시에만 재계산
  const cells = useMemo(
    () => collectInputCells(questions, sourceQuestionId),
    [questions, sourceQuestionId],
  );

  // 값이 binop 이면 "셀 산술", 아니면 (undefined 또는 옛 단일 cell 데이터) "응답값 그대로".
  const isBinop = value?.kind === 'binop';
  const mode: 'current' | 'binop' = isBinop ? 'binop' : 'current';

  const literalValue = isBinop && value.right.kind === 'literal' ? value.right.value : null;
  // binop.right 가 literal 일 때 raw string 보존 (부분 입력 `-`, `.` 허용)
  const [literalDraft, setLiteralDraft] = useState(() => ({
    source: literalValue,
    raw: literalValue !== null ? String(literalValue) : '',
  }));
  const literalRaw =
    literalDraft.source === literalValue
      ? literalDraft.raw
      : literalValue !== null
        ? String(literalValue)
        : '';

  const onModeChange = (next: 'current' | 'binop') => {
    if (next === mode) return;
    if (next === 'current') {
      onChange(undefined);
    } else {
      onChange({
        kind: 'binop',
        op: '/',
        left: emptyCellRef(),
        right: emptyCellRef(),
      });
    }
  };

  const renderCellSelect = (ref: CellRef, on: (next: CellRef) => void) => {
    const composite =
      ref.questionId && ref.cellId ? `${ref.questionId}::${ref.cellId}` : '';
    return (
      <Select
        value={composite}
        onValueChange={(v) => {
          const [questionId = '', cellId = ''] = v.split('::');
          on({ kind: 'cell', questionId, cellId });
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="셀 선택" />
        </SelectTrigger>
        <SelectContent>
          {cells.length === 0 ? (
            <div className="text-muted-foreground px-2 py-1.5 text-sm">
              사용 가능한 input 셀이 없습니다
            </div>
          ) : (
            cells.map((c) => (
              <SelectItem
                key={`${c.cellRef.questionId}::${c.cellRef.cellId}`}
                value={`${c.cellRef.questionId}::${c.cellRef.cellId}`}
              >
                {c.label}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    );
  };

  return (
    <div className="space-y-2">
      <Tabs
        value={mode}
        onValueChange={(v) => onModeChange(v as 'current' | 'binop')}
      >
        <TabsList>
          <TabsTrigger value="current">응답값 그대로</TabsTrigger>
          <TabsTrigger value="binop">셀 산술 (셀 ± 셀/숫자)</TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === 'current' && (
        <div className="text-xs text-gray-500">
          위에서 선택한 셀의 응답값을 비교 좌변으로 사용합니다.
        </div>
      )}

      {mode === 'binop' && isBinop && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_80px_1fr] items-center gap-2">
            {renderCellSelect(value.left, (next) =>
              onChange({ ...value, left: next }),
            )}
            <Select
              value={value.op}
              onValueChange={(op) =>
                onChange({ ...value, op: op as '+' | '-' | '*' | '/' })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['+', '-', '*', '/'] as const).map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {value.right.kind === 'cell' ? (
              renderCellSelect(value.right, (next) =>
                onChange({ ...value, right: next }),
              )
            ) : (
              <Input
                inputMode="decimal"
                value={literalRaw}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!isPartialNumericInput(raw)) return;
                  setLiteralDraft({ source: literalValue, raw });
                  const parsed = parseNumericInput(raw);
                  if (parsed !== null) {
                    onChange({
                      ...value,
                      right: { kind: 'literal', value: parsed },
                    });
                  }
                }}
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">우변 종류</span>
            <Select
              value={value.right.kind}
              onValueChange={(k) =>
                onChange({
                  ...value,
                  right:
                    k === 'cell'
                      ? emptyCellRef()
                      : { kind: 'literal', value: 0 },
                })
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cell">셀</SelectItem>
                <SelectItem value="literal">숫자</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
