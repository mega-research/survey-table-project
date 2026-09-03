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
  /**
   * 유효 메일 상태 — 수신거부 판정(unsubscribed_at 또는 최근 결과코드 수신거부)이면 발송 이력과
   * 무관하게 'skipped_unsubscribed', 아니면 최신(created_at DESC) 수신 상태. 발송 이력 없으면 null.
   * 필터의 수신거부 판정과 같은 축(effectiveMailStatusExpr).
   */
  latestMailStatus: MailRecipientStatus | null;
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

/* ── 이전 응답(추적조사) ─────────────────────────────── */

/**
 * inviteToken 으로 이월 응답을 조회하는 입력.
 *
 * inviteToken 에 uuid 를 강제하지 않는 이유는 attrs lookup 과 같다 —
 * 무효/malformed 토큰은 service 가 null 로 흡수해 익명 응답 폴백을 보존한다.
 */
export const LookupPriorAnswersInput = z.object({
  surveyId: z.string(),
  inviteToken: z.string(),
});
export type LookupPriorAnswersInput = z.infer<typeof LookupPriorAnswersInput>;

/**
 * 이월 응답 조회 결과. 이월 응답이 없거나 토큰이 무효면 null.
 * 값은 응답 저장 형태(questionResponses)와 동형이라 임의 JSON 이 들어온다.
 */
export const PriorAnswersOutput = z.custom<Record<string, unknown> | null>();
export type PriorAnswersOutput = z.infer<typeof PriorAnswersOutput>;

// ── 이월 응답 임포트 (추적조사) ──

/** 매핑 제안 요청 — 시트/헤더 행을 고른 뒤 컬럼과 문항을 잇는 제안을 받는다. */
export const SuggestPriorAnswerMappingInput = z.object({
  surveyId: z.string(),
  file: z.instanceof(File),
  sheetName: z.string().optional(),
  /** 헤더로 읽을 행 수. 3 이면 파트/문항코드/세부라벨 3단 병합 헤더. */
  headerRowCount: z.number().int().min(1).max(3).optional(),
});
export type SuggestPriorAnswerMappingInput = z.infer<typeof SuggestPriorAnswerMappingInput>;

export const SuggestPriorAnswerMappingResultSchema = z.object({
  sheetNames: z.array(z.string()),
  /** 헤더 행 격자 — 컬럼 인덱스 순서 그대로, 병합 종속 칸은 빈 문자열. */
  headerRows: z.array(z.array(z.string())),
  /** 표본 데이터 행 — 컬럼 인덱스 순서 그대로. */
  rows: z.array(z.array(z.string())),
  totalRows: z.number(),
  /** 문항코드 행에서 잘라낸 컬럼 블록과 자동 제안. 배열 인덱스가 곧 블록 번호다. */
  blocks: z.array(
    z.object({
      code: z.string(),
      /** 문항 내용 대조에 쓴 텍스트 — 담당자가 판정 근거를 볼 수 있어야 한다. */
      label: z.string(),
      part: z.string(),
      columnIndexes: z.array(z.number()),
      detailLabels: z.array(z.string()),
      questionId: z.string().nullable(),
      /** value 는 블록 값이 이 문항의 보기와 맞아 제안된 것 — 코드·제목이 아니라 값으로 잇는다. */
      matchedBy: z.enum(['code', 'label', 'value']).nullable(),
      verdict: z.enum(['auto', 'code-conflict', 'value-conflict', 'label-candidate', 'unmapped']),
      /** code-conflict·value-conflict·value 후보일 때 코드가 가리킨 문항 */
      conflictQuestionId: z.string().nullable(),
      /** 값 적합도 판정의 근거("표본 180건 중 보기와 맞는 값 0건 …") — 화면이 배지 아래 그대로 찍는다. */
      verdictReason: z.string().nullable(),
      /** 확정 설정에서 되살린 매핑인가 — 화면이 "지난 확정" 으로 표시한다. */
      fromSavedConfig: z.boolean(),
      /** 블록 컬럼별 배정 결과. 표 위치 폴백의 조용한 오배정을 눈으로 확인하는 자리다. */
      slotLabels: z.array(z.string()),
      unmatchedSlots: z.number(),
    }),
  ),
  /** 보관된 값 대응 — 화면이 이 상태로 시작해야 지난 확정이 재사용된다. */
  savedValueAliases: z.record(z.string(), z.record(z.string(), z.string())),
  /** 화면의 수동 매핑 선택지. */
  questions: z.array(
    z.object({
      id: z.string(),
      questionCode: z.string().nullable(),
      title: z.string(),
      type: z.string(),
      /** 이 문항의 선택지 — 안 맞은 원본 값을 그 자리에서 이어줄 때 쓴다. */
      options: z.array(z.object({ value: z.string(), label: z.string() })),
    }),
  ),
});
export type SuggestPriorAnswerMappingResult = z.infer<
  typeof SuggestPriorAnswerMappingResultSchema
>;

export const ImportPriorAnswersInput = z.object({
  surveyId: z.string(),
  file: z.instanceof(File),
  sheetName: z.string(),
  /** 헤더로 읽을 행 수 (1~3). */
  headerRowCount: z.number().int().min(1).max(3),
  /** 조사 대상을 찾을 컬럼 인덱스 — 설문별 자동 발번 번호(시스템ID) */
  residColumnIndex: z.number().int().min(0),
  /** 블록 번호(문자열) → 문항 id */
  mapping: z.record(z.string(), z.string()),
  /**
   * 이번 화면에서 이어준 값 대응 — 문항 id → { 원본 값 → 선택지 저장값 }.
   * 요청에 실려 오므로 미리보기가 서버 설정을 건드리지 않고도 결과에 반영된다.
   */
  valueAliases: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  /** true 면 적재하지 않고 결과만 계산한다 (실행 전 미리보기). */
  dryRun: z.boolean().optional(),
});
export type ImportPriorAnswersInput = z.infer<typeof ImportPriorAnswersInput>;

export const ImportPriorAnswersResultSchema = z.object({
  /** 시트에서 값이 만들어진 조사 대상 수 */
  parsedTargets: z.number(),
  /** 그중 명단에서 찾아 이월 응답을 붙인 수 */
  matched: z.number(),
  /** 명단에서 찾지 못한 조사 대상 번호 (최대 50건 절단) */
  unmatchedResids: z.array(z.string()),
  unmatched: z.number(),
  emptyResidRows: z.number(),
  duplicateResidRows: z.number(),
  /** 잇지 않은 블록의 문항코드 */
  unmappedColumns: z.array(z.string()),
  /** 이월 값이 하나도 들어가지 않은 문항 id */
  questionsWithoutValues: z.array(z.string()),
  /** 이 경로가 다룰 수 없는 문항으로 매핑된 것 */
  unsupportedQuestionIds: z.array(z.string()),
  /** 문항별 선택지 변환 실패. 실패율 내림차순 — 경고 수십 줄에 묻히지 않게. */
  optionMismatches: z.array(
    z.object({
      questionId: z.string(),
      total: z.number(),
      unmatched: z.number(),
      /** unmatched / total (0~1) */
      rate: z.number(),
      values: z.array(z.object({ value: z.string(), count: z.number() })),
    }),
  ),
});
export type ImportPriorAnswersResult = z.infer<typeof ImportPriorAnswersResultSchema>;

/** 확정 매핑·값 대응 저장 — 다시 올릴 때 그대로 재사용된다. */
export const SavePriorAnswerImportConfigInput = z.object({
  surveyId: z.string(),
  /** 정규화된 문항코드 → 확정 문항 id + 그때의 문항 내용 */
  blockMappings: z.record(
    z.string(),
    z.object({ questionId: z.string(), label: z.string() }),
  ),
  /** 문항 id → { 원본 값 → 선택지 저장값 } */
  valueAliases: z.record(z.string(), z.record(z.string(), z.string())),
});
export type SavePriorAnswerImportConfigInput = z.infer<
  typeof SavePriorAnswerImportConfigInput
>;
