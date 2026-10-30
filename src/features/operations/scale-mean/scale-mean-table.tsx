import Link from 'next/link';

import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  formatScaleMean,
  overallRowLabel,
  type ScaleMeanSummary,
} from '@/lib/operations/scale-mean-format';
import { cn } from '@/lib/utils';

interface Props {
  surveyId: string;
  summary: ScaleMeanSummary;
}

const CELL = 'border-r border-gray-300 px-3 last:border-r-0';

/**
 * 척도 평균 표 (CONTEXT.md 「척도 평균」) — 엑셀처럼 한눈에 보는 격자 하나.
 * 구분 · 문항 · 평균 · 응답수 네 열, 맨 위 「전체」 줄이 종합 평균이다. 막대·요약 카드는 두지 않는다
 * (2026-10-30 시안 검토 — 숫자가 먼저 읽혀야 한다).
 */
export function ScaleMeanTable({ surveyId, summary }: Props) {
  if (summary.overall.kind === 'empty') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-12 text-center">
        <p className="text-sm font-semibold text-gray-900">평균을 낼 문항이 없습니다</p>
        <p className="text-sm text-gray-500">
          문항 편집에서 「척도 평균에 넣기」를 켜면 여기에 문항별 평균과 응답수가 나옵니다.
        </p>
        <Link href={`/admin/surveys/${surveyId}/edit`} className="mt-2">
          <Button variant="outline" size="sm">
            <Pencil className="mr-2 h-4 w-4" />
            설문 편집
          </Button>
        </Link>
      </div>
    );
  }

  const { overall, rows } = summary;

  return (
    <div className="space-y-2">
      <table className="w-full max-w-[880px] table-fixed border-collapse border border-gray-300 bg-white text-sm">
        <colgroup>
          <col className="w-[96px]" />
          <col />
          <col className="w-[90px]" />
          <col className="w-[90px]" />
        </colgroup>
        <thead>
          <tr className="h-10 border-b border-gray-300 bg-gray-100 text-left font-semibold text-gray-700">
            <th scope="col" className={CELL}>
              구분
            </th>
            <th scope="col" className={CELL}>
              문항
            </th>
            <th scope="col" className={cn(CELL, 'text-right')}>
              평균
            </th>
            <th scope="col" className={cn(CELL, 'text-right')}>
              응답수
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="h-10 border-b-2 border-gray-300 bg-blue-50">
            <th scope="row" className={cn(CELL, 'text-left font-bold text-blue-700')}>
              전체
            </th>
            <td className={cn(CELL, 'truncate text-gray-900')}>{overallRowLabel(rows)}</td>
            <td className={cn(CELL, 'text-right font-bold text-blue-700 tabular-nums')}>
              {overall.kind === 'mean' ? formatScaleMean(overall.mean) : '—'}
            </td>
            <td className={cn(CELL, 'text-right text-gray-900 tabular-nums')}>
              {overall.kind === 'mean' ? overall.count.toLocaleString() : '—'}
            </td>
          </tr>
          {rows.map((row) => (
            <tr key={row.varName} className="h-10 border-b border-gray-300 last:border-b-0">
              <th scope="row" className={cn(CELL, 'truncate text-left font-bold text-gray-900')}>
                {row.varName}
              </th>
              <td className={cn(CELL, 'truncate text-gray-900')} title={row.label}>
                {row.label}
              </td>
              <td className={cn(CELL, 'text-right font-bold text-gray-900 tabular-nums')}>
                {formatScaleMean(row.mean)}
              </td>
              <td className={cn(CELL, 'text-right text-gray-900 tabular-nums')}>
                {row.count.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {overall.kind === 'mixed-scale' && (
        <p className="text-xs text-gray-500">
          척도가 다른 문항이 섞여 있어 전체 평균을 내지 않습니다.
        </p>
      )}
    </div>
  );
}
