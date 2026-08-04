'use client';

import { useMemo } from 'react';
import { evaluateCellFormula } from '@/lib/survey/cell-formula';
import { useFormulaEvalCtx } from '@/lib/survey/formula-context';
import { UNIT_LABELS, formatWithComma } from '@/utils/number-format';
import type { TableCell } from '@/types/survey';

import { CellContentLayout } from './cell-content-layout';

interface Props {
  cell: TableCell;
  questionId: string;
}

// 읽기 전용 계산 표시 셀. 렌더마다 파생 계산 — 저장은 저장 경계(withCalcValues)가 담당.
export function CalcCell({ cell, questionId }: Props) {
  const ctx = useFormulaEvalCtx();

  const value = useMemo(() => {
    if (!ctx || !cell.formula) return null;
    return evaluateCellFormula(cell.formula, questionId, ctx, cell.numberFormat?.decimalPlaces);
  }, [ctx, cell.formula, cell.numberFormat?.decimalPlaces, questionId]);

  const unit = cell.numberFormat?.unit;
  // UNIT_LABELS 는 percent 도 '%' 로 이미 매핑되어 있어 별도 분기가 필요 없다.
  const unitLabel = unit ? UNIT_LABELS[unit] : '';
  const display =
    value === null
      ? '—'
      : cell.numberFormat?.thousandSeparator
        ? formatWithComma(String(value))
        : String(value);

  // 텍스트 라벨(content) 배치는 다른 인터랙티브 셀과 같은 CellContentLayout 을 쓴다 —
  // 위치 규칙이 갈리면 같은 표에서 계산 셀만 다르게 정렬된다.
  return (
    <CellContentLayout
      content={cell.content}
      position={cell.textPosition}
      bold={cell.textBold}
    >
      <div className="flex items-center gap-1 px-2 py-1.5 text-sm tabular-nums text-gray-700">
        <span className="font-medium">{display}</span>
        {unitLabel ? <span className="text-gray-500">{unitLabel}</span> : null}
      </div>
    </CellContentLayout>
  );
}
