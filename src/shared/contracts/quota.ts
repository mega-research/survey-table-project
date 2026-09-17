// 쿼터 플랜 계약 — surveys.quota_config.
// DB 스키마($type<>)·서버·UI 가 공유하는 어휘 — 런타임 의존 없음(리터럴 상수 제외).

// ── 쿼터 (surveys.quota_config) ──────────────────────────────
/** 한 차원 안의 구간. kind='choice'면 values, kind='numeric'이면 min/max 사용. */
export interface QuotaCategory {
  id: string;
  label: string;
  /**
   * choice: 이 카테고리에 속하는 보기값(수동=option.value, 테이블소스=cell.id)
   * `| undefined` 명시: zod `.optional()` 추론 타입과 exactOptionalPropertyTypes 하에서
   * 정합하려면 필요(features/quota/domain 의 컴파일 타임 zod↔drizzle 가드 참조).
   */
  values?: string[] | undefined;
  /** numeric: 반열림 구간 min ≤ 값 < max (null = 무한) */
  min?: number | null | undefined;
  max?: number | null | undefined;
}

/** 쿼터 축. 문항 1개에 바인딩. */
export interface QuotaDimension {
  id: string;
  questionId: string;
  label: string;
  kind: 'choice' | 'numeric';
  categories: QuotaCategory[];
}

/** 셀 = 차원 카테고리 조합 + 목표. categoryIds는 dimensions 순서대로. */
export interface QuotaCell {
  categoryIds: string[];
  target: number;
}

/** surveys.quota_config — 설문 쿼터 플랜 전체 (NULL = 쿼터 없음) */
export interface QuotaConfig {
  /** 집행 on/off. false면 정의·집계만 하고 응답자 차단 안 함. */
  enabled: boolean;
  dimensions: QuotaDimension[];
  /** sparse — 목표가 있는 셀만 */
  cells: QuotaCell[];
  /** 마감 종료 화면 문구. null이면 기본 폴백. */
  closedMessage: string | null;
}
