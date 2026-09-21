// 쿼터 플랜 계약 — surveys.quota_config.
// DB 스키마($type<>)·서버·UI 가 공유하는 어휘 — 런타임 의존 없음(리터럴 상수 제외).

// ── 쿼터 (surveys.quota_config) ──────────────────────────────
/** 쿼터 차원 유형 — 옵션형·숫자형(문항) · 조사 대상 속성형(명단 attrs 열) · 텍스트형(자유 텍스트 키워드). */
export const QUOTA_DIMENSION_KINDS = ['choice', 'numeric', 'attr', 'text'] as const;
export type QuotaDimensionKind = (typeof QUOTA_DIMENSION_KINDS)[number];

/**
 * 한 차원 안의 구간. choice·attr 은 values, numeric 은 min/max, text 는 keywords/isElse 사용.
 */
export interface QuotaCategory {
  id: string;
  label: string;
  /**
   * choice: 이 카테고리에 속하는 보기값(수동=option.value, 테이블소스=cell.id)
   * attr: 이 카테고리에 속하는 명단 값(앞뒤 공백만 정돈해 완전 일치)
   * `| undefined` 명시: zod `.optional()` 추론 타입과 exactOptionalPropertyTypes 하에서
   * 정합하려면 필요(features/quota/domain 의 컴파일 타임 zod↔drizzle 가드 참조).
   */
  values?: string[] | undefined;
  /** numeric: 반열림 구간 min ≤ 값 < max (null = 무한) */
  min?: number | null | undefined;
  max?: number | null | undefined;
  /** text: 대상 칸 중 하나라도 이 중 하나를 포함하면 매칭(OR). 공백·영문 대소문자 무시. */
  keywords?: string[] | undefined;
  /** text: 「그 외」 — 값은 있으나 앞선 카테고리에 안 걸린 응답을 받는다. 차원의 마지막에 둔다. */
  isElse?: boolean | undefined;
}

/** 쿼터 축. 소스 하나에 바인딩 — 문항(choice·numeric·text) 또는 명단 attrs 열(attr). */
export interface QuotaDimension {
  id: string;
  /** attr 차원은 문항이 없어 빈 문자열이다. */
  questionId: string;
  label: string;
  kind: QuotaDimensionKind;
  /** attr: 명단 attrs 열 키 */
  attrKey?: string | undefined;
  /** text: 표 문항의 대상 input 셀 id 목록. 단답형 문항이면 비운다. */
  cellIds?: string[] | undefined;
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

/** 응답 화면이 받는 쿼터 게이트 — 집행 중인 플랜에서만 만들어진다. */
export interface QuotaGate {
  /** 런타임 필수로 취급하고, 전부 답변되면 쿼터 확인을 1회 발동하는 문항들 */
  questionIds: string[];
  /**
   * 텍스트형 차원의 대상 칸 — 표 응답은 객체라 객체 존재만으로 "답변됨"이 되면 주소를 적기 전에
   * 1회뿐인 확인이 소진된다. 여기 등재된 문항은 대상 칸 중 하나라도 값이 있어야 답변으로 본다.
   */
  cellIdsByQuestion?: Record<string, string[]>;
  /** 문항 기반 차원이 하나도 없는 플랜(조사 대상 속성형만) — 첫 페이지 전환에서 확인한다. */
  checkWithoutQuestions?: boolean;
}
