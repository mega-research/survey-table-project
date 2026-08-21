import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import type { MailRecipientStatus } from '@/shared/contracts/mail';
import { recipientStatusMeta } from '@/components/operations/mail-campaign/recipient-status-badge';
import { mapStatusPill } from '@/lib/operations/profiles';
import { buildInviteUrl } from '@/lib/survey-url';

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
  'system.web': '응답 상태',
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
  const candidates: DownloadColumnCandidate[] = [...(scheme.columns ?? [])]
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

/** export 셀 포맷에 필요한 행 데이터 — listContactsForExport 결과 + 복호화 PII */
export interface ContactExportRowData {
  resid: number;
  attrs: Record<string, string>;
  /** columnKey → 복호화 평문 (복호화 실패는 빈 문자열) */
  piiPlain: Record<string, string>;
  latestResultCode: string | null;
  latestAttemptNo: number | null;
  latestMailStatus: MailRecipientStatus | null;
  progressPct: number | null;
  /** 매칭 응답 status (completed/in_progress/drop 등). 응답 없으면 null */
  responseStatus: string | null;
  inviteCode: string;
}

/** 목록 표(contacts-table)와 동일 표기 규칙으로 셀 값 생성 */
export function formatExportCell(
  source: string,
  row: ContactExportRowData,
  inviteBaseUrl: string,
): string | number {
  if (source === 'system.resid') return row.resid;
  if (source === 'system.contact_result') {
    return row.latestResultCode
      ? `[${row.latestAttemptNo}] ${row.latestResultCode}`
      : '';
  }
  if (source === 'system.email_count') {
    return row.latestMailStatus ? recipientStatusMeta(row.latestMailStatus).label : '';
  }
  if (source === 'system.web') {
    // 목록 표의 StatusPill 과 같은 상태 어휘 — 완료는 라벨만, 미완료(진행중·이탈 등)는
    // 진행율 % 부속 표기. 응답 없으면 빈 문자열.
    if (row.responseStatus == null) return '';
    const label = mapStatusPill({ status: row.responseStatus }).label;
    return row.responseStatus !== 'completed' && row.progressPct != null
      ? `${label} ${row.progressPct}%`
      : label;
  }
  if (source === INVITE_URL_SOURCE) {
    return buildInviteUrl(row.inviteCode, inviteBaseUrl);
  }
  if (source.startsWith('attrs.')) {
    return row.attrs[source.slice('attrs.'.length)] ?? '';
  }
  if (source.startsWith('pii.')) {
    return row.piiPlain[source.slice('pii.'.length)] ?? '';
  }
  return '';
}
