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

/**
 * 외주 링크가 보는 쿼터 셀 — **내 달성 수와 마감 여부뿐이다** (fieldwork-multi-company 티켓 08, PRD 스토리 40·41).
 *
 * 목표(`target`)·전체 달성 수(`current`)·달성률(`pct`)·톤(`tone` — 달성률을 되짚을 수 있다)은 일부러
 * 없다. 연구원 결정으로 외주는 남의 몫을 짐작할 재료를 화면에도 RSC payload 에도 받지 않는다 —
 * 키를 빼는 것이 요점이라 `QuotaCellStatus` 를 좁혀 쓰지 않고 따로 둔다(구조적 타입이라 넓은 값이
 * 그대로 실려 직렬화된다).
 */
export interface ShareQuotaCellStatus {
  categoryIds: string[];
  /** 차원 순서대로 카테고리 라벨 */
  labels: string[];
  /** 지금 담당 범위에 든 조사 대상의 완료 수 — 같이 맡은 대상은 맡은 링크마다 센다 */
  mine: number;
  /** 셀 마감 여부 — 설문 전체 완료 기준, 집행(`checkQuota`)과 같은 술어 `current >= target` */
  closed: boolean;
}

export interface ShareQuotaStatus {
  enabled: boolean;
  dimensions: QuotaStatusDimension[];
  cells: ShareQuotaCellStatus[];
}

/** 응답 현황 KPI 카드의 쿼터 칸 — 외주 투영판. 비율(목표 대비)은 목표를 되짚게 하므로 없다. */
export interface ShareQuotaSummary {
  /** 목표 셀에 분류된 내 완료 수 합 */
  mineTotal: number;
  /** 마감된 셀 수 — 목표 0 셀도 마감이면 센다(셀 단위 표시와 같은 술어) */
  closedCells: number;
  totalCells: number;
}

/**
 * 외주 링크 투영 — 마감은 `all`(설문 전체 완료)로, 내 달성 수는 `mine`(담당 범위 대상의 완료)으로 센다.
 *
 * 두 모수는 같은 로더(`loadCompletedQuotaSubjects`)의 같은 정의에서 나와야 한다 — `mine` 은 `all` 의
 * 부분 집합이다. 마감 판정을 내 수로 하면 다른 업체가 채운 셀을 외주가 계속 걸게 된다.
 */
export function buildShareQuotaStatus(
  config: NormalizedQuotaConfig,
  all: QuotaSubject[],
  mine: QuotaSubject[],
): ShareQuotaStatus {
  const allCounts = tallyAll(config, all);
  const mineCounts = tallyAll(config, mine);
  return {
    enabled: config.enabled,
    dimensions: config.dimensions.map((d) => ({
      id: d.id,
      label: d.label,
      categories: d.categories.map((c) => ({ id: c.id, label: c.label })),
    })),
    cells: config.cells.map((cell) => {
      const key = cellKeyOf(cell.categoryIds);
      return {
        categoryIds: cell.categoryIds,
        labels: cell.categoryIds.map((cid, i) => labelForCategory(config, i, cid)),
        mine: mineCounts.get(key) ?? 0,
        closed: (allCounts.get(key) ?? 0) >= cell.target,
      };
    }),
  };
}

export function summarizeShareQuota(status: ShareQuotaStatus): ShareQuotaSummary {
  return {
    mineTotal: status.cells.reduce((s, c) => s + c.mine, 0),
    closedCells: status.cells.filter((c) => c.closed).length,
    totalCells: status.cells.length,
  };
}

/**
 * 응답 현황 KPI 카드의 쿼터 칸 — 어느 모양인지를 값이 들고 다닌다(판별 유니온).
 *
 * `full` 은 설문 전체 목표·달성(내부 콘솔·클라이언트·한 번도 나누지 않은 외주 링크), `share` 는 나눈 외주
 * 링크의 투영(내 완료 수·마감 셀 수)이다. 갈래는 서버가 담당 범위로 한 번 정하고(`getQuotaViewForShare`),
 * 카드는 `kind` 로만 고른다 — 키 유무(`'mineTotal' in …`)로 다시 판정하지 않는다.
 */
export type QuotaKpi =
  | { kind: 'full'; summary: QuotaSummary }
  | { kind: 'share'; mine: ShareQuotaSummary };

/** 쿼터 현황 한 벌 — 위와 같은 갈래로 현황판까지. */
export type QuotaView =
  | { kind: 'full'; status: QuotaStatus }
  | { kind: 'share'; status: ShareQuotaStatus };

export function quotaKpiOf(view: QuotaView): QuotaKpi {
  return view.kind === 'full'
    ? { kind: 'full', summary: view.status.summary }
    : { kind: 'share', mine: summarizeShareQuota(view.status) };
}
