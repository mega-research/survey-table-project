import { type QuotaSubject, cellKeyOf, deriveCategoryIds, tallyAll } from '@/lib/quota/matching';
import type { NormalizedQuotaConfig } from '@/lib/quota/normalize';

export type QuotaCellTone = 'done' | 'good' | 'warn' | 'low';

export interface QuotaCellStatus {
  categoryIds: string[];
  /** 차원 순서대로 카테고리 라벨 */
  labels: string[];
  target: number;
  current: number;
  /** current/target*100 (target 0 → 100). 정수 반올림. */
  pct: number;
  tone: QuotaCellTone;
}

export interface QuotaStatusDimension {
  id: string;
  label: string;
  categories: { id: string; label: string }[];
}

export interface QuotaSummary {
  targetTotal: number;
  /** 분류되어 목표 셀에 속한 완료 수 합 */
  currentTotal: number;
  pct: number;
  closedCells: number;
  totalCells: number;
  /**
   * 미분류 완료 수 — 차원 중 하나라도 카테고리를 얻지 못한 완료 응답. 쿼터 밖에서 새는 응답이라
   * 키워드·값 누락의 유일한 신호다. 목표 없는(sparse) 셀에 분류된 응답은 여기 세지 않는다.
   */
  unclassified: number;
}

export interface QuotaStatus {
  enabled: boolean;
  dimensions: QuotaStatusDimension[];
  cells: QuotaCellStatus[];
  summary: QuotaSummary;
}

/** 셀 진척 톤. 100%+ done / 70%+ good / 40%+ warn / else low. target 0 은 done(즉시 마감). */
export function quotaTone(current: number, target: number): QuotaCellTone {
  if (target <= 0) return 'done';
  const pct = (current / target) * 100;
  if (pct >= 100) return 'done';
  if (pct >= 70) return 'good';
  if (pct >= 40) return 'warn';
  return 'low';
}

function labelForCategory(config: NormalizedQuotaConfig, dimensionIndex: number, categoryId: string): string {
  const dim = config.dimensions[dimensionIndex];
  // quota_config 는 JSONB 라 categories 누락 저장분이 있을 수 있다 — 라벨은 id 폴백.
  const cat = dim?.categories.find((c) => c.id === categoryId);
  return cat?.label ?? categoryId;
}

/**
 * 목표 표본 총합 — 셀은 sparse 라(목표가 있는 조합만) 합이 곧 설문 전체의 목표다.
 *
 * 쿼터 요약과 **실사 홈의 진척 분모**가 같은 셈을 봐야 해서 내보낸다(티켓 25). 사본을 두면
 * 한쪽만 고쳐져 같은 설문이 화면마다 다른 목표를 갖는다.
 */
export function sumQuotaTargets(cells: readonly { target: number }[]): number {
  return cells.reduce((sum, cell) => sum + cell.target, 0);
}

/** 완료 응답(판정 대상) 목록 → 셀별 현황 + 요약. */
export function buildQuotaStatus(
  config: NormalizedQuotaConfig,
  subjects: QuotaSubject[],
): QuotaStatus {
  const counts = tallyAll(config, subjects);
  const unclassified = subjects.filter((s) => deriveCategoryIds(config, s) === null).length;

  const cells: QuotaCellStatus[] = config.cells.map((cell) => {
    const current = counts.get(cellKeyOf(cell.categoryIds)) ?? 0;
    const target = cell.target;
    const pct = target > 0 ? Math.round((current / target) * 100) : 100;
    return {
      categoryIds: cell.categoryIds,
      labels: cell.categoryIds.map((cid, i) => labelForCategory(config, i, cid)),
      target,
      current,
      pct,
      tone: quotaTone(current, target),
    };
  });

  const targetTotal = sumQuotaTargets(cells);
  const currentTotal = cells.reduce((s, c) => s + c.current, 0);
  const closedCells = cells.filter((c) => c.current >= c.target && c.target > 0).length;

  return {
    enabled: config.enabled,
    dimensions: config.dimensions.map((d) => ({
      id: d.id,
      label: d.label,
      categories: d.categories.map((c) => ({ id: c.id, label: c.label })),
    })),
    cells,
    summary: {
      targetTotal,
      currentTotal,
      pct: targetTotal > 0 ? Math.round((currentTotal / targetTotal) * 100) : 0,
      closedCells,
      totalCells: cells.length,
      unclassified,
    },
  };
}
