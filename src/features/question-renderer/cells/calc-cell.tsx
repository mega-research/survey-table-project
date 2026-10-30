'use client';

import { useMemo } from 'react';

import { useFormulaEvalCtx } from '@/features/question-renderer/formula-context';
import { getInputTextAlignClass } from '@/features/question-renderer/utils/table-grid-utils';
import { evaluateCellFormula } from '@/lib/survey/cell-formula';
import { cn } from '@/lib/utils';
import type { TableCell } from '@/types/survey';
import { UNIT_LABELS, formatWithComma } from '@/utils/number-format';

import { CellContentLayout } from './cell-content-layout';

interface Props {
  cell: TableCell;
  questionId: string;
  /** 값 너비 고정을 무시한다 — 세로 카드. InputCell 의 같은 prop 과 같은 규칙 */
  ignoreInputWidth?: boolean | undefined;
}

// 읽기 전용 계산 표시 셀. 렌더마다 파생 계산 — 저장은 저장 경계(withCalcValues)가 담당.
export function CalcCell({ cell, questionId, ignoreInputWidth }: Props) {
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

  // 값 너비 고정 — 입력 칸의 「입력칸 너비」와 같은 규칙. 지정하면 값 칸이 셀을 채우지 않아
  // 오른쪽 단위 글자(content)가 값 바로 뒤에 붙고, 같은 열의 입력 칸과 값·단위 자리가 맞는다.
  const fixedWidth =
    !ignoreInputWidth && typeof cell.inputWidth === 'number' && cell.inputWidth > 0
      ? cell.inputWidth
      : undefined;

  // 텍스트 라벨(content) 배치는 다른 인터랙티브 셀과 같은 CellContentLayout 을 쓴다 —
  // 위치 규칙이 갈리면 같은 표에서 계산 셀만 다르게 정렬된다.
  return (
    <CellContentLayout
      content={cell.content}
      contentHtml={cell.contentHtml}
      position={cell.textPosition}
      bold={cell.textBold}
      boldFirstLine={cell.boldFirstLine}
      textColor={cell.textColor}
      fillWidth={fixedWidth === undefined}
      horizontalAlign={cell.horizontalAlign}
    >
      {/* 값과 단위는 인라인이라 블록 컨테이너의 text-align 으로 정렬이 성립한다 */}
      <div
        className={cn(
          'w-full px-2 py-1.5 text-base text-gray-700 tabular-nums',
          getInputTextAlignClass(cell.inputTextAlign),
        )}
        style={fixedWidth !== undefined ? { width: `${fixedWidth}px`, maxWidth: '100%' } : undefined}
      >
        <span className="font-medium">{display}</span>
        {unitLabel ? <span className="ml-1 text-gray-500">{unitLabel}</span> : null}
      </div>
    </CellContentLayout>
  );
}
