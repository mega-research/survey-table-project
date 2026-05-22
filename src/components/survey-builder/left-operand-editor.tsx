'use client';

import { useEffect, useState } from 'react';

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
import { isPartialNumericInput, parseNumericInput } from '@/utils/numeric-input';

interface Props {
  value: LeftOperand;
  onChange: (next: LeftOperand) => void;
}

interface CellOption {
  label: string;
  cellRef: CellRef;
}

/**
 * 테이블 질문의 모든 input 셀을 평탄화하여 셀렉터 옵션으로 변환.
 * 라벨 포맷: `질문제목 > 행라벨 / 셀라벨` (셀라벨 = exportLabel ?? cellCode ?? id slice).
 *
 * TableCell 에는 직접적인 label 필드가 없으므로 exportLabel > cellCode > id 순으로 fallback.
 */
function collectInputCells(questions: Question[]): CellOption[] {
  const out: CellOption[] = [];
  for (const q of questions) {
    if (q.type !== 'table' || !q.tableRowsData) continue;
    for (const row of q.tableRowsData) {
      for (const c of row.cells ?? []) {
        if (c.type !== 'input') continue;
        const rowLabel = row.label?.trim() || row.id.slice(0, 6);
        const cellLabel = c.exportLabel ?? c.cellCode ?? c.id.slice(0, 6);
        out.push({
          label: `${q.title} > ${rowLabel} / ${cellLabel}`,
          cellRef: { kind: 'cell', questionId: q.id, cellId: c.id },
        });
      }
    }
  }
  return out;
}

const emptyCellRef = (): CellRef => ({ kind: 'cell', questionId: '', cellId: '' });

const isRealCellRef = (ref: CellRef): boolean =>
  Boolean(ref.questionId && ref.cellId);

export function LeftOperandEditor({ value, onChange }: Props) {
  const questions = useSurveyBuilderStore((s) => s.currentSurvey.questions);
  const cells = collectInputCells(questions);

  const isBinop = value.kind === 'binop';
  const mode: 'cell' | 'binop' = isBinop ? 'binop' : 'cell';

  // literal 우변은 raw string 으로 controlled — 부분 입력(`-`, `.`) 보존을 위해
  // value.right.value 가 바뀌면 sync, 사용자 타이핑 중에는 raw 만 갱신.
  const [literalRaw, setLiteralRaw] = useState<string>(() =>
    isBinop && value.right.kind === 'literal' ? String(value.right.value) : '',
  );

  useEffect(() => {
    if (isBinop && value.right.kind === 'literal') {
      const next = String(value.right.value);
      // raw 가 parsing 결과와 동일한 값이면 갱신하지 않아 부분 입력 보존.
      if (parseNumericInput(literalRaw) !== value.right.value) {
        setLiteralRaw(next);
      }
    }
  }, [isBinop, value, literalRaw]);

  const onModeChange = (next: 'cell' | 'binop') => {
    if (next === mode) return;
    if (next === 'cell') {
      // binop → cell: binop.left 가 실제 셀이면 보존, 아니면 기존 left 슬롯도 비어있으니 그대로.
      if (isBinop && isRealCellRef(value.left)) {
        onChange(value.left);
      } else {
        onChange(emptyCellRef());
      }
    } else {
      // cell → binop: 현재 단일 셀을 left 로 보존, right 는 비어있는 셀로 초기화.
      const preservedLeft: CellRef = isRealCellRef(value as CellRef)
        ? (value as CellRef)
        : emptyCellRef();
      onChange({
        kind: 'binop',
        op: '/',
        left: preservedLeft,
        right: emptyCellRef(),
      });
    }
  };

  const renderCellSelect = (
    ref: CellRef,
    on: (next: CellRef) => void,
  ) => {
    const composite =
      ref.questionId && ref.cellId ? `${ref.questionId}::${ref.cellId}` : '';
    return (
      <Select
        value={composite}
        onValueChange={(v) => {
          const [questionId, cellId] = v.split('::');
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
      <Tabs value={mode} onValueChange={(v) => onModeChange(v as 'cell' | 'binop')}>
        <TabsList>
          <TabsTrigger value="cell">단일 셀</TabsTrigger>
          <TabsTrigger value="binop">셀 산술 (셀 + 셀/숫자)</TabsTrigger>
        </TabsList>
      </Tabs>

      {!isBinop && renderCellSelect(value, (next) => onChange(next))}

      {isBinop && (
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
                  setLiteralRaw(raw);
                  const parsed = parseNumericInput(raw);
                  // 빈 입력·부분 입력은 store 에 반영하지 않고 raw 만 유지 →
                  // 다음 입력에서 완전한 숫자가 되면 그때 commit.
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
