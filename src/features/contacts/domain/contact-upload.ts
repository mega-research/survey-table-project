import * as z from 'zod';

import type { ContactUploadMapping } from '@/shared/contracts/contacts';

export type { ContactUploadMapping };

/** 엑셀 업로드 매핑(복잡 JSONB)은 z.custom 으로 타입만 보장. */
export const ContactUploadMappingSchema = z.custom<ContactUploadMapping>();

/**
 * File 입력은 z.instanceof(File) 로 받는다.
 * File 은 Node 20+/Next 16 런타임의 글로벌이라 별도 import 불필요(런타임 import 0 유지).
 * 클라(브라우저) serializer 가 Blob/File 을 multipart 로 직렬화 → fetch 경계에서 FormData 변환.
 */
export const ParseExcelPreviewInput = z.object({
  file: z.instanceof(File),
  sheetName: z.string().optional(),
  headerRow: z.number().optional(),
});
export type ParseExcelPreviewInput = z.infer<typeof ParseExcelPreviewInput>;

export const ParseExcelPreviewResultSchema = z.object({
  sheetNames: z.array(z.string()),
  headers: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.string())),
  totalRows: z.number(),
});
export type ParseExcelPreviewResult = z.infer<typeof ParseExcelPreviewResultSchema>;

export const IngestContactUploadInput = z.object({
  surveyId: z.string(),
  file: z.instanceof(File),
  mapping: ContactUploadMappingSchema,
});
export type IngestContactUploadInput = z.infer<typeof IngestContactUploadInput>;

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

export const MatchContactUploadInput = z.object({
  surveyId: z.string(),
  file: z.instanceof(File),
  mapping: ContactUploadMappingSchema,
});
export type MatchContactUploadInput = z.infer<typeof MatchContactUploadInput>;

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
