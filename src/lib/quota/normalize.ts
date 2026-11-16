import type { QuotaCell, QuotaConfig, QuotaDimension } from '@/shared/contracts/quota';

declare const NORMALIZED_QUOTA: unique symbol;

/**
 * 정규화를 거친 쿼터 플랜 — `dimensions`·`cells`·각 차원의 `categories` 가 모두 배열임이
 * 보장된다.
 *
 * `surveys.quota_config` 는 `.$type<QuotaConfig>()` 로 선언돼 있지만 JSONB 는 그 배열 계약을
 * 강제하지 않는다. 컨택 컬럼 스킴이 같은 이유로 진척 보고를 500 으로 죽였다
 * (`normalizeContactColumnScheme` 참조). 여기서는 그 사고가 나기 전에 같은 처방을 건다.
 *
 * `normalizeQuotaConfig` 만 이 타입을 만들 수 있고, 배열을 무보호로 순회하는 소비 함수는 이
 * 타입만 받는다. DB JSONB 를 그대로 넘기는 호출부는 컴파일에서 걸린다.
 */
export type NormalizedQuotaConfig = QuotaConfig & {
  readonly [NORMALIZED_QUOTA]: true;
};

/**
 * quota_config JSONB 드리프트 보정.
 *
 * 배열이어야 할 자리가 배열이 아니면 빈 배열로 낮추되 나머지 필드는 보존한다 — 플랜을
 * 통째로 버리면 쿼터 설정이 사라진 것처럼 보인다. 차원의 `categories` 까지 한 단계 더
 * 들어가야 하는 점이 컬럼 스킴과 다르다.
 */
export function normalizeQuotaConfig(raw: unknown): NormalizedQuotaConfig | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const config = raw as QuotaConfig;

  const dimensions: QuotaDimension[] = (Array.isArray(config.dimensions) ? config.dimensions : [])
    .filter((d): d is QuotaDimension => d !== null && typeof d === 'object')
    .map((d) => (Array.isArray(d.categories) ? d : { ...d, categories: [] }));

  const cells: QuotaCell[] = (Array.isArray(config.cells) ? config.cells : []).filter(
    (c): c is QuotaCell => c !== null && typeof c === 'object' && Array.isArray(c.categoryIds),
  );

  // 브랜드는 런타임에 존재하지 않는 표식이므로 이 한 곳에서만 단언한다.
  return {
    ...config,
    dimensions,
    cells,
    // 키가 있을 때만 정돈한다 — 「완료」 조건을 쓴 적 없는 플랜의 모양은 그대로 둔다.
    ...('totalTarget' in config ? { totalTarget: quotaTotalTarget(config) } : {}),
  } as unknown as NormalizedQuotaConfig;
}

/**
 * 「완료」 조건의 목표 — 1 이상 정수일 때만 값, 그 밖(부재·null·JSONB 드리프트)은 null.
 * 판정·게이트·현황·편집 화면이 "완료 조건이 있는가"를 이 함수 하나로 묻는다.
 */
export function quotaTotalTarget(
  config: Pick<QuotaConfig, 'totalTarget'> | null | undefined,
): number | null {
  const value: unknown = config?.totalTarget;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

/** 「완료」 조건의 목표로 받는 상한 — 서버 검증(QuotaConfigSchema)과 같은 값. */
export const QUOTA_TOTAL_TARGET_MAX = 10_000_000;

/**
 * 편집 화면의 입력 글자 → 「완료」 조건의 목표. 빈 칸·1 미만·정수가 아닌 값·상한 초과는 null(저장 불가).
 * 해석 못 한 입력을 0 이나 「조건 없음」으로 조용히 바꾸지 않는다.
 */
export function parseQuotaTotalTarget(text: string): number | null {
  const trimmed = text.replace(/,/g, '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 1 && value <= QUOTA_TOTAL_TARGET_MAX ? value : null;
}
