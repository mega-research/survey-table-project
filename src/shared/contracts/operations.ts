// 운영 콘솔 컬럼 픽커 계약 — surveys.progress_columns·profile_columns.
// DB 스키마($type<>)·서버·UI 가 공유하는 어휘 — 런타임 의존 없음(리터럴 상수 제외).

/** surveys.progress_columns — 진척률 표 (Report 탭) 그룹 메타 컬럼 픽커 */
export interface ProgressColumnScheme {
  version: number;
  columns: ProgressColumnDef[];
  /** 진척률 표의 시스템ID(firstResid) 컬럼 표시 여부. 미지정(구 스킴)은 true. */
  showResid?: boolean;
}

export interface ProgressColumnDef {
  /** attrs 키 (예: '개최 월', '개최기간'). source 는 항상 attrs.<key> — system.* 제외. */
  key: string;
  /** 표 헤더 라벨 (사용자 편집 가능). 컨택리스트 라벨과 별도. */
  label: string;
  order: number;
  hidden?: boolean;
}

/** surveys.profile_columns — 응답 내역(profiles) 표시 컬럼 픽커. NULL = 기본 스킴(기존 9컬럼). */
export interface ProfileColumnScheme {
  version: number;
  columns: ProfileColumnDef[];
}

export interface ProfileColumnDef {
  /**
   * 컬럼 식별자.
   * - `sys.<id>`: 시스템 컬럼 (idx/resid/group/platform/browser/status/startedAt/completedAt/totalSeconds/ipHash)
   * - `attrs.<key>`: 컨택 attrs 값
   * - `pii.<key>`: 컨택 PII (목록 렌더 시 복호화 표시)
   */
  key: string;
  /** 표 헤더 라벨 (사용자 편집 가능). 컨택리스트 라벨과 별도. */
  label: string;
  order: number;
  hidden?: boolean;
}
