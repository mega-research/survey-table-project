import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatSeconds, numberFormatter } from '@/lib/operations/format';
import type { ResponseTimeRow } from '@/lib/operations/response-time';

interface Props {
  data: ResponseTimeRow[];
}

/** 통계 셀 표시. n=0 인 행은 호출 측에서 일괄 '—' 처리. */
function formatStat(value: number | null): string {
  if (value === null) return '—';
  return formatSeconds(value);
}

interface StatColumnSpec {
  key: 'n' | 'avg' | 'avgTrimmed' | 'min' | 'max';
  label: string;
}

const STAT_COLUMNS: StatColumnSpec[] = [
  { key: 'n', label: 'N' },
  { key: 'avg', label: '평균' },
  { key: 'avgTrimmed', label: '절사평균(±2.5%)' },
  { key: 'min', label: '최소' },
  { key: 'max', label: '최대' },
];

/**
 * 운영 현황 콘솔 — A4 응답시간 통계 표.
 *
 * - 4행 고정: Total / Desktop / Mobile / Pad. 빈 행도 그대로 노출 (— 표시).
 * - Total 행은 시각적으로 강조 (배경색 + semibold).
 * - 시간 컬럼은 'M:SS' (1시간 미만) / 'H:MM:SS' (이상) 형식.
 * - 트리밍 평균에 대한 안내 문구를 카드 하단에 노출 (목업 동일).
 *
 * Server Component. 정렬/필터링이 없어 클라이언트 훅이 필요하지 않다.
 */
export function ResponseTimeStats({ data }: Props) {
  return (
    <Card>
      <CardHeader className="px-5 pt-4 pb-2">
        <CardTitle className="text-sm font-semibold text-slate-900">
          응답시간 통계
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-slate-600"
                >
                  {/* 라벨 컬럼 헤더는 비워둔다 (목업 동일) */}
                </th>
                {STAT_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-slate-600"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const isTotal = row.scope === 'total';
                const isEmpty = row.n === 0;
                return (
                  <tr
                    key={row.scope}
                    className={cn(
                      'border-b border-slate-100',
                      isTotal && 'bg-slate-50 font-semibold',
                    )}
                  >
                    <th
                      scope="row"
                      className={cn(
                        'px-3 py-2 text-left',
                        isTotal ? 'text-slate-900' : 'text-slate-700',
                      )}
                    >
                      {row.label}
                    </th>
                    <td
                      className={cn(
                        'px-3 py-2 text-right tabular-nums',
                        isTotal ? 'text-slate-900' : 'text-slate-700',
                      )}
                    >
                      {isEmpty ? '—' : numberFormatter.format(row.n)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right tabular-nums',
                        isTotal ? 'text-slate-900' : 'text-slate-700',
                      )}
                    >
                      {isEmpty ? '—' : formatStat(row.avg)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right tabular-nums',
                        isTotal ? 'text-slate-900' : 'text-slate-700',
                      )}
                    >
                      {isEmpty ? '—' : formatStat(row.avgTrimmed)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right tabular-nums',
                        isTotal ? 'text-slate-900' : 'text-slate-700',
                      )}
                    >
                      {isEmpty ? '—' : formatStat(row.min)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right tabular-nums',
                        isTotal ? 'text-slate-900' : 'text-slate-700',
                      )}
                    >
                      {isEmpty ? '—' : formatStat(row.max)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          ※ 절사평균 = 상하 2.5% 이상값 제외 (며칠 뒤 재접속 보정)
        </p>
      </CardContent>
    </Card>
  );
}
