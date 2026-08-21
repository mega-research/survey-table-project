'use client';

import React, { useMemo } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableColumn, TableRow } from '@/types/survey';

/** 테이블 요약 통계 컴포넌트 (useMemo로 불필요한 재계산 방지) */
export const TableSummaryCard = React.memo(function TableSummaryCard({
  rows,
  columns,
}: {
  rows: TableRow[];
  columns: TableColumn[];
}) {
  const stats = useMemo(() => {
    let interactiveCount = 0;
    let mediaCount = 0;
    for (const row of rows) {
      for (const cell of row.cells) {
        if (
          cell.type === 'checkbox' ||
          cell.type === 'radio' ||
          cell.type === 'select' ||
          cell.type === 'input'
        ) {
          interactiveCount++;
        }
        if (cell.type === 'image' || cell.type === 'video') {
          mediaCount++;
        }
      }
    }
    return {
      totalCells: rows.length * columns.length,
      interactiveCount,
      mediaCount,
    };
  }, [rows, columns]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>테이블 요약</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div className="rounded-lg bg-blue-50 p-3">
            <div className="font-medium text-blue-600">전체 크기</div>
            <div className="text-lg font-bold text-blue-900">
              {rows.length} × {columns.length}
            </div>
            <div className="text-xs text-blue-600">행 × 열</div>
          </div>
          <div className="rounded-lg bg-green-50 p-3">
            <div className="font-medium text-green-600">총 셀 수</div>
            <div className="text-lg font-bold text-green-900">{stats.totalCells}</div>
            <div className="text-xs text-green-600">개</div>
          </div>
          <div className="rounded-lg bg-purple-50 p-3">
            <div className="font-medium text-purple-600">인터랙티브 셀</div>
            <div className="text-lg font-bold text-purple-900">{stats.interactiveCount}</div>
            <div className="text-xs text-purple-600">개</div>
          </div>
          <div className="rounded-lg bg-orange-50 p-3">
            <div className="font-medium text-orange-600">미디어 셀</div>
            <div className="text-lg font-bold text-orange-900">{stats.mediaCount}</div>
            <div className="text-xs text-orange-600">개</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
