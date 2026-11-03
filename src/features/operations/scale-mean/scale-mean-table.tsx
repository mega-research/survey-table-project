import Link from 'next/link';

import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  type ScaleMeanCandidate,
  type ScaleMeanSummary,
  formatScaleMean,
  formatScaleMean100,
  overallRowLabel,
} from '@/lib/operations/scale-mean-format';
import { cn } from '@/lib/utils';

import { ScaleMeanQuestionPicker } from './scale-mean-question-picker';
import { TruncatedText } from './truncated-text';

interface Props {
  surveyId: string;
  summary: ScaleMeanSummary;
  candidates: ScaleMeanCandidate[];
}

const CELL = 'border-r border-gray-300 px-3 last:border-r-0';

/**
 * 척도 평균 표 (CONTEXT.md 「척도 평균」) — 엑셀처럼 한눈에 보는 격자 하나.
 * 구분 · 문항 · 평균 · 100점 환산 · 응답수 다섯 열, 맨 위 「전체」 줄이 종합 평균이다. 100점 환산은
 * 척도 최저 0 · 최고 100 으로 바꾼 평균이다(2026-10-30 요청 — 7점 척도 1→0, 7→100, 소수 첫째 자리). 막대·요약 카드·부제목은 두지 않는다
 * (2026-10-30 시안 검토 — 숫자가 먼저 읽혀야 한다). 치수는 pencil/척도평균_시안.pen 「A」(열 80/·/90/90 · 행 38 · 13px) · 표 862 를 화면 가운데에 둔다(폭은 페이지 main 이 정한다).
 */
export function ScaleMeanTable({ surveyId, summary, candidates }: Props) {
  if (summary.overall.kind === 'empty') {
    if (candidates.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-semibold text-gray-900">평균을 낼 수 있는 문항이 없습니다</p>
          <p className="text-sm text-gray-500">
            단일 선택·드롭다운 문항이나 행마다 라디오 칸을 묶은 척도 표가 있어야 합니다.
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
    // 켠 문항이 없으면 안내 대신 고르는 목록을 바로 보인다
    return (
      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-5">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">평균을 낼 문항을 고르세요</p>
          <p className="text-sm text-gray-500">
            고른 문항의 완료 응답 평균과 응답수가 표로 나옵니다. 나중에 「문항 선택」으로 바꿀 수
            있습니다.
          </p>
        </div>
        <ScaleMeanQuestionPicker surveyId={surveyId} candidates={candidates} />
      </div>
    );
  }

  const { overall, rows } = summary;

  return (
    <div className="space-y-2">
      <table className="w-full table-fixed border-collapse border border-gray-300 bg-white text-[13px]">
        <colgroup>
          <col className="w-[80px]" />
          <col />
          <col className="w-[90px]" />
          <col className="w-[90px]" />
          <col className="w-[90px]" />
        </colgroup>
        <thead>
          <tr className="h-[38px] border-b border-gray-300 bg-gray-100 text-left font-semibold text-gray-700">
            <th scope="col" className={CELL}>
              구분
            </th>
            <th scope="col" className={cn(CELL, 'text-gray-900')}>
              문항
            </th>
            <th scope="col" className={cn(CELL, 'text-right')}>
              평균
            </th>
            <th scope="col" className={cn(CELL, 'text-right')}>
              100점 환산
            </th>
            <th scope="col" className={cn(CELL, 'text-right')}>
              응답수
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="h-[38px] border-b-2 border-gray-300 bg-blue-50">
            <th scope="row" className={cn(CELL, 'text-left font-bold text-blue-700')}>
              전체
            </th>
            <td className={cn(CELL, 'truncate text-gray-900')}>{overallRowLabel(rows)}</td>
            <td className={cn(CELL, 'text-right font-bold text-blue-700 tabular-nums')}>
              {overall.kind === 'mean' ? formatScaleMean(overall.mean) : '—'}
            </td>
            <td className={cn(CELL, 'text-right font-bold text-blue-700 tabular-nums')}>
              {formatScaleMean100(overall.mean100)}
            </td>
            <td className={cn(CELL, 'text-right text-gray-900 tabular-nums')}>
              {overall.count.toLocaleString()}
            </td>
          </tr>
          {rows.map((row) => (
            <tr key={row.varName} className="h-[38px] border-b border-gray-300 last:border-b-0">
              <th scope="row" className={cn(CELL, 'truncate text-left font-bold text-gray-900')}>
                {row.varName}
              </th>
              <td className={cn(CELL, 'text-gray-900')}>
                <TruncatedText text={row.label} />
              </td>
              <td className={cn(CELL, 'text-right font-bold text-gray-900 tabular-nums')}>
                {formatScaleMean(row.mean)}
              </td>
              <td className={cn(CELL, 'text-right font-bold text-gray-900 tabular-nums')}>
                {formatScaleMean100(row.mean100)}
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
          척도가 다른 문항이 섞여 있어 전체 평균(원점수)을 내지 않습니다. 100점 환산 전체는 문항마다
          제 척도로 환산한 뒤 응답자별로 평균한 값입니다.
        </p>
      )}
    </div>
  );
}
