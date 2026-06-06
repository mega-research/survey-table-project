import * as z from 'zod';

import type { ContactUploadMapping } from '@/db/schema/schema-types';

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
});
export type IngestContactUploadResult = z.infer<typeof IngestContactUploadResultSchema>;
