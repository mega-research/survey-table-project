// 컨택 경계 계약 — 업로드 마법사 RPC 입출력과 컨택 콘솔 read model 행.
// 같은 폴더의 contacts.ts — DB 에 저장되는 JSONB 문서 어휘. 이 파일 — 서버와 UI 사이 경계를 건너는 모양.
// client-safe — zod 밖 런타임 의존 없음(server-only·Node·DB 없음).
import * as z from 'zod';

import { PII_FIELD_TYPES, type PiiFieldType } from '@/lib/crypto/pii-fields';
import type { ContactUploadMode } from '@/shared/contracts/contacts';
import type { MailRecipientStatus } from '@/shared/contracts/mail';
import type { ResponseEditChange } from '@/shared/contracts/survey-response';

// ─────────────────────────────────────────────────────────────────────────────
// 컨택 상세 편집 — PII 변경분
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PII 컬럼 1건 변경분. service 가 contact_pii 에 재암호화 upsert.
 * plain 이 빈 문자열이면 기존 PII row 삭제.
 */
export const PiiUpdateSchema = z.object({
  /** ContactColumnDef.source 가 'pii.<columnKey>' 인 컬럼의 columnKey */
  columnKey: z.string(),
  // z.custom 은 런타임 검증이 없어 오탈자(예: 'e-mail') 가 통과 → normalizePii 의 switch 가
  // default 없이 undefined 반환 → blindIndex 빈 문자열 → upsertPiiValue 가 기존 PII 행을
  // 삭제하는 사고로 이어짐. PII_FIELD_TYPES enum 으로 경계에서 차단.
  fieldType: z.enum(PII_FIELD_TYPES),
  /** 평문값. 빈 문자열이면 기존 PII row 삭제. */
  plain: z.string(),
});
export type PiiUpdate = z.infer<typeof PiiUpdateSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 엑셀 업로드 마법사 — 각 단계의 결과 모양 (미리보기 / 대조 / 반영)
// ─────────────────────────────────────────────────────────────────────────────

export const ParseExcelPreviewResultSchema = z.object({
  sheetNames: z.array(z.string()),
  headers: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.string())),
  totalRows: z.number(),
});
export type ParseExcelPreviewResult = z.infer<typeof ParseExcelPreviewResultSchema>;

export const IngestContactUploadResultSchema = z.object({
  uploadId: z.string(),
  uploadedRows: z.number(),
  mergedRows: z.number(),
  errorRows: z.number(),
  skippedRows: z.number(),
  /** 제외 사유별 세부 (DB 미저장 — 결과 화면 표시용) */
  skippedBreakdown: z.object({
    policy: z.number(),
    fileDuplicates: z.number(),
    multiMatches: z.number(),
    emptyKeys: z.number(),
  }),
});
export type IngestContactUploadResult = z.infer<typeof IngestContactUploadResultSchema>;

const MatchSampleSchema = z.object({
  /** 엑셀 실제 행 번호 (1-based, 헤더 행 이후) */
  excelRow: z.number(),
  /** 키 헤더명 → 셀 값 */
  keyValues: z.record(z.string(), z.string()),
});

export const MatchContactUploadResultSchema = z.object({
  matched: z.number(),
  unmatched: z.number(),
  fileDuplicates: z.number(),
  multiMatches: z.number(),
  emptyKeys: z.number(),
  /** 그룹별 최대 50건 절단 (카운트는 전체 기준) */
  unmatchedSamples: z.array(MatchSampleSchema),
  fileDuplicateSamples: z.array(MatchSampleSchema),
  multiMatchSamples: z.array(MatchSampleSchema),
  emptyKeySamples: z.array(MatchSampleSchema),
  /** 빈 값 덮어쓰기 경고 — 컬럼별 집계 */
  emptyOverwrites: z.array(
    z.object({ columnKey: z.string(), count: z.number(), isPii: z.boolean() }),
  ),
});
export type MatchContactUploadResult = z.infer<typeof MatchContactUploadResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 컨택 콘솔 read model 행 — RSC 가 SQL 로 뽑아 클라이언트 표에 props 로 넘기는 모양.
// 조회 자체는 server/read-models/contacts.server 소관이고 여기는 모양만 둔다.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContactsRow {
  id: string;
  resid: number;
  groupValue: string | null;
  /** attrs 통째 (비PII 만 포함됨 — PII 는 piiMaskHints 에) */
  attrs: Record<string, string>;
  /** PII 컬럼별 마스킹 힌트 (columnKey → { fieldType, maskHint }) */
  piiMaskHints: Record<string, { fieldType: PiiFieldType; maskHint: string | null }>;
  /** 최신 attempt result_code (없으면 null) */
  latestResultCode: string | null;
  latestAttemptNo: number | null;
  respondedAt: Date | null;
  /** 응답 진행률 0~100. 응답 없거나 첫 답변 전 / soft-delete 면 null */
  progressPct: number | null;
  /** 매칭 응답의 status (completed/in_progress/drop 등). 응답 없으면 null */
  responseStatus: string | null;
  /** 최신(created_at DESC) 메일 수신 상태. 발송 이력 없으면 null */
  latestMailStatus: MailRecipientStatus | null;
  /** 수신거부 시각 — 메일 컬럼에서 발송 상태보다 우선 표시 (필터의 수신거부 판정과 동일 축) */
  unsubscribedAt: Date | null;
  inviteToken: string;
  createdAt: Date;
}

export interface ContactUploadRow {
  id: string;
  filename: string;
  uploadedRows: number;
  mergedRows: number;
  errorRows: number;
  mode: ContactUploadMode;
  skippedRows: number;
  createdAt: Date;
}

export interface ContactAttemptRow {
  id: string;
  attemptNo: number;
  resultCode: string;
  note: string | null;
  createdAt: Date;
}

export interface MailHistoryRow {
  /** mail_recipients.id — React key 용 */
  id: string;
  campaignTitle: string;
  runNumber: number;
  /** 'single'이면 단건 발송 — 회차 대신 "단건" 표기 */
  kind: 'bulk' | 'single';
  status: MailRecipientStatus;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  bouncedAt: Date | null;
  errorReason: string | null;
  createdAt: Date;
}

export interface ResponseEditLogRow {
  id: string;
  action: 'edit' | 'reset' | 'reedit_allow';
  editorEmail: string | null;
  changedQuestions: ResponseEditChange[];
  changedCount: number;
  createdAt: Date;
}
