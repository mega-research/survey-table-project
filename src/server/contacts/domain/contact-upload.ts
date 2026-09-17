import * as z from 'zod';

import type { ContactUploadMapping } from '@/shared/contracts/contacts';
import {
  type IngestContactUploadResult,
  IngestContactUploadResultSchema,
  type MatchContactUploadResult,
  MatchContactUploadResultSchema,
  type ParseExcelPreviewResult,
  ParseExcelPreviewResultSchema,
} from '@/shared/contracts/contacts-io';

export type { ContactUploadMapping };
// 각 단계 결과 모양은 계약(@/shared/contracts/contacts-io) 소관 — 여기서 다시 내보내
// procedure output·service 반환 타입의 import 경로를 유지한다.
export {
  IngestContactUploadResultSchema,
  MatchContactUploadResultSchema,
  ParseExcelPreviewResultSchema,
};
export type { IngestContactUploadResult, MatchContactUploadResult, ParseExcelPreviewResult };

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

export const IngestContactUploadInput = z.object({
  surveyId: z.string(),
  file: z.instanceof(File),
  mapping: ContactUploadMappingSchema,
});
export type IngestContactUploadInput = z.infer<typeof IngestContactUploadInput>;

export const MatchContactUploadInput = z.object({
  surveyId: z.string(),
  file: z.instanceof(File),
  mapping: ContactUploadMappingSchema,
});
export type MatchContactUploadInput = z.infer<typeof MatchContactUploadInput>;
