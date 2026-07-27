import type { ContactColumnScheme } from '@/db/schema/schema-types';

/**
 * 조사 대상 다운로드 컬럼 로직 (순수 모듈 — DB/서버 의존 없음).
 * 후보 조립·cols 화이트리스트 검증을 다이얼로그(RSC 조립)와 export 라우트가 공유한다.
 */

/** 스킴에 없는 다운로드 전용 특수 컬럼 — 초대링크 */
export const INVITE_URL_SOURCE = 'system.invite_url';

/** 스킴에 해당 시스템 컬럼이 없을 때 쓰는 폴백 라벨 */
const EXTRA_SOURCE_LABELS: Record<string, string> = {
  'system.contact_result': '컨택결과',
  'system.email_count': '메일 상태',
  'system.web': '설문 진행율',
  [INVITE_URL_SOURCE]: '초대링크',
};

/** placeholder 전용 — 다운로드 후보에서 제외 */
const EXCLUDED_SOURCES = new Set(['system.contact_owner']);

export interface DownloadColumnCandidate {
  source: string;
  label: string;
  defaultChecked: boolean;
}

export interface ExportColumn {
  source: string;
  label: string;
}

/**
 * 다운로드 다이얼로그 컬럼 후보.
 * 스킴 전체(hidden 포함, order 순) + 스킴에 없는 특수 컬럼(회차결과·메일·진행율·초대링크)을
 * 뒤에 폴백 라벨로 추가. 기본 체크는 non-hidden 스킴 컬럼만.
 */
export function buildDownloadCandidates(
  scheme: ContactColumnScheme,
): DownloadColumnCandidate[] {
  const candidates = [...(scheme.columns ?? [])]
    .filter((c) => !EXCLUDED_SOURCES.has(c.source))
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ source: c.source, label: c.label, defaultChecked: !c.hidden }));

  const present = new Set(candidates.map((c) => c.source));
  for (const [source, label] of Object.entries(EXTRA_SOURCE_LABELS)) {
    if (!present.has(source)) {
      candidates.push({ source, label, defaultChecked: false });
    }
  }
  return candidates;
}

/**
 * 라우트 cols 파라미터 검증 — 후보 화이트리스트에 있는 source 만 통과 (중복 제거).
 * 순서는 요청 순서 유지.
 */
export function resolveExportColumns(
  colsParams: string[],
  scheme: ContactColumnScheme,
): ExportColumn[] {
  const allowed = new Map(
    buildDownloadCandidates(scheme).map((c) => [c.source, c.label]),
  );
  const seen = new Set<string>();
  const out: ExportColumn[] = [];
  for (const source of colsParams) {
    if (seen.has(source)) continue;
    const label = allowed.get(source);
    if (label === undefined) continue;
    seen.add(source);
    out.push({ source, label });
  }
  return out;
}
