'use client';

import { AlertTriangle } from 'lucide-react';

import type { CrossTabResult, PercentageBase } from '@/lib/analytics/cross-tab';

interface PivotTableProps {
  result: CrossTabResult;
  percentageBase: PercentageBase;
  showCounts: boolean;
}

export function PivotTable({ result, percentageBase, showCounts }: PivotTableProps) {
  const getCellValue = (
    cell: { rowPercent: number; colPercent: number; totalPercent: number },
    base: PercentageBase,
  ): number => {
    switch (base) {
      case 'row':
        return cell.rowPercent;
      case 'column':
        return cell.colPercent;
      case 'total':
        return cell.totalPercent;
    }
  };

  // 셀 배경색 계산 (히트맵 효과)
  const getCellColor = (percentage: number): string => {
    if (percentage === 0) return 'bg-gray-50';
    if (percentage < 10) return 'bg-blue-50';
    if (percentage < 25) return 'bg-blue-100';
    if (percentage < 40) return 'bg-blue-200';
    if (percentage < 55) return 'bg-blue-300';
    if (percentage < 70) return 'bg-blue-400 text-white';
    return 'bg-blue-500 text-white';
  };

  return (
    <div className="overflow-x-auto">
      {/* 표본 수 경고 */}
      {result.hasLowSampleWarning && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4" />
          <span>일부 셀의 표본 수가 30 미만입니다. 통계적 해석에 주의가 필요합니다.</span>
        </div>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {/* 빈 셀 (좌상단) */}
            <th className="min-w-[150px] border border-gray-200 bg-gray-100 p-3 text-left font-semibold text-gray-700">
              {result.rowQuestion.title}
            </th>

            {/* 열 헤더 */}
            {result.columns.map((col) => (
              <th
                key={col.value}
                className="min-w-[100px] border border-gray-200 bg-gray-100 p-3 text-center font-medium text-gray-700"
              >
                <div>{col.label}</div>
                <div className="mt-1 text-xs font-normal text-gray-500">n={col.total}</div>
              </th>
            ))}

            {/* 합계 열 */}
            <th className="min-w-[80px] border border-gray-200 bg-gray-200 p-3 text-center font-semibold text-gray-800">
              합계
            </th>
          </tr>
        </thead>

        <tbody>
          {result.rows.map((row) => (
            <tr key={row.value}>
              {/* 행 헤더 */}
              <td className="border border-gray-200 bg-gray-50 p-3 font-medium text-gray-700">
                <div>{row.label}</div>
                <div className="text-xs font-normal text-gray-500">n={row.total}</div>
              </td>

              {/* 데이터 셀 */}
              {row.cells.map((cell, colIndex) => {
                const percentage = getCellValue(cell, percentageBase);
                return (
                  <td
                    key={colIndex}
                    className={`border border-gray-200 p-3 text-center ${getCellColor(percentage)}`}
                  >
                    <div className="font-semibold">{percentage.toFixed(1)}%</div>
                    {showCounts && <div className="mt-1 text-xs opacity-75">({cell.count})</div>}
                  </td>
                );
              })}

              {/* 행 합계 */}
              <td className="border border-gray-200 bg-gray-100 p-3 text-center font-semibold">
                <div>{row.total}</div>
                <div className="text-xs font-normal text-gray-500">
                  {row.rowPercent.toFixed(1)}%
                </div>
              </td>
            </tr>
          ))}

          {/* 합계 행 */}
          <tr className="bg-gray-200">
            <td className="border border-gray-200 p-3 font-semibold text-gray-800">합계</td>
            {result.columns.map((col) => (
              <td key={col.value} className="border border-gray-200 p-3 text-center font-semibold">
                <div>{col.total}</div>
                <div className="text-xs font-normal text-gray-600">
                  {col.colPercent.toFixed(1)}%
                </div>
              </td>
            ))}
            <td className="border border-gray-200 p-3 text-center font-bold text-gray-900">
              {result.grandTotal}
            </td>
          </tr>
        </tbody>
      </table>

      {/* 범례 */}
      <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
        <span>색상 강도:</span>
        <div className="flex gap-1">
          <div className="h-4 w-6 rounded border bg-gray-50" title="0%" />
          <div className="h-4 w-6 rounded border bg-blue-100" title="10-25%" />
          <div className="h-4 w-6 rounded border bg-blue-200" title="25-40%" />
          <div className="h-4 w-6 rounded border bg-blue-300" title="40-55%" />
          <div className="h-4 w-6 rounded border bg-blue-400" title="55-70%" />
          <div className="h-4 w-6 rounded border bg-blue-500" title="70%+" />
        </div>
        <span className="ml-2">낮음 → 높음</span>
      </div>
    </div>
  );
}
