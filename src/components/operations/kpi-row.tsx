import type { StatusCounts } from '@/lib/operations/aggregate-status';
import { numberFormatter } from '@/lib/operations/format';
import type { QuotaSummary } from '@/lib/operations/quota-status';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface KpiRowProps {
  counts: StatusCounts;
  /** 쿼터 요약. 쿼터 미설정(getQuotaStatus null)이면 undefined/null — 카드 자체를 숨긴다. */
  quota?: QuotaSummary | null;
}

interface KpiCellSpec {
  /** 셀 라벨 (목업 기준 한국어). */
  label: string;
  /** counts에서 이 셀이 보여줄 값 키 */
  field: keyof StatusCounts;
  /**
   * 비율 텍스트(△n%)에 적용할 색상 — 'drop'은 의미상 부정적이므로 rose 톤.
   * total 셀은 '100%'를 보여주는 것이 어색하므로 숨김 처리.
   * 'live'는 진행중 셀 전용 — 펄스 인디케이터 + "live" 텍스트로 렌더된다.
   */
  deltaTone?: 'rose' | 'slate' | 'live' | 'hidden';
}

const CELLS: KpiCellSpec[] = [
  { label: '전체', field: 'total', deltaTone: 'hidden' },
  { label: '진행중', field: 'inProgress', deltaTone: 'live' },
  { label: '완료', field: 'completed', deltaTone: 'slate' },
  { label: '자격 미달', field: 'screenedOut', deltaTone: 'slate' },
  { label: '불량', field: 'bad', deltaTone: 'slate' },
  { label: '이탈', field: 'drop', deltaTone: 'rose' },
];

function formatValue(value: number, isEmpty: boolean): string {
  if (isEmpty) return '—';
  return numberFormatter.format(value);
}

function formatDelta(
  value: number,
  total: number,
  tone: KpiCellSpec['deltaTone'],
  isEmpty: boolean,
): string {
  if (tone === 'hidden') return '';
  if (tone === 'live') return 'live';
  if (isEmpty || total === 0) return '—';
  const pct = (value / total) * 100;
  // 소수 첫째 자리 — 분석 페이지와 동일한 표기 정책
  return `${pct.toFixed(1)}%`;
}

interface KpiCellProps {
  label: string;
  value: string;
  delta: string;
  deltaTone: KpiCellSpec['deltaTone'];
}

function KpiCell({ label, value, delta, deltaTone }: KpiCellProps) {
  return (
    <Card>
      <CardContent className="px-4 py-3 pt-3">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
        {deltaTone !== 'hidden' && (
          <div className={cn(
            'mt-0.5 flex items-center gap-1 text-xs',
            deltaTone === 'rose' && 'text-rose-600',
            deltaTone === 'live' && 'text-blue-600',
            deltaTone === 'slate' && 'text-slate-400',
          )}>
            {deltaTone === 'live' && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse motion-reduce:animate-none" />
            )}
            <span>{delta}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 쿼터 진행 카드 — 예전 "쿼터마감" 단일 카운트 셀을 대체한다.
 * 완료/목표 총합 대비 % + 마감된 셀 수(closedCells)를 함께 보여줘, 쿼터 전체
 * 진척을 한눈에 파악할 수 있게 한다. 셀 단위 상세는 QuotaStatusPanel 담당.
 */
function QuotaKpiCell({ quota }: { quota: QuotaSummary }) {
  return (
    <Card>
      <CardContent className="px-4 py-3 pt-3">
        <p className="text-xs text-slate-500">쿼터</p>
        <p className="mt-1 text-2xl font-semibold text-blue-600">{quota.pct}%</p>
        <p className="mt-0.5 text-xs text-slate-400">
          {numberFormatter.format(quota.currentTotal)}/{numberFormatter.format(quota.targetTotal)} ·{' '}
          {quota.closedCells} 마감
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * 운영 현황 콘솔 — A1 KPI Row.
 * 6개 셀(전체 / 진행중 / 완료 / 자격 미달 / 불량 / 이탈) + (쿼터 설정 시) 쿼터 진행 카드를
 * 가로로 나열한다. 쿼터마감 카운트는 더 이상 단일 셀이 아니라 쿼터 진행 카드(quota.closedCells)에
 * 흡수됐다 — 셀별 상세는 QuotaStatusPanel 참조.
 *
 * total === 0 (종결 응답 없음)일 때:
 *   - 종결성 셀은 "—"로 표기 (전체/완료/자격미달/불량/이탈)
 *   - 진행중 셀(deltaTone === 'live')은 in_progress 가시성이 존재 이유라 항상 실수 노출
 *   - 페이지 단위 EmptyState는 상위 컴포지션에서 처리한다 (plan §9).
 */
export function KpiRow({ counts, quota }: KpiRowProps) {
  const isEmpty = counts.total === 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {CELLS.map((cell) => {
        const value = counts[cell.field];
        // 진행중 셀은 isEmpty 와 무관하게 항상 카운트 노출 (live 가시성 보존)
        const cellIsEmpty = cell.deltaTone === 'live' ? false : isEmpty;
        return (
          <KpiCell
            key={cell.field}
            label={cell.label}
            value={formatValue(value, cellIsEmpty)}
            delta={formatDelta(value, counts.total, cell.deltaTone, cellIsEmpty)}
            deltaTone={cell.deltaTone}
          />
        );
      })}
      {quota && <QuotaKpiCell quota={quota} />}
    </div>
  );
}
