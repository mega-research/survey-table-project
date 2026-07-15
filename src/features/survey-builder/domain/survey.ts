import * as z from 'zod';

import type { Survey as SurveyRow } from '@/db/schema';
import type { Survey as SurveyType, SurveySettings } from '@/types/survey';

export type { SurveyRow, SurveyType, SurveySettings };

/**
 * 설문 CRUD 도메인 스키마.
 *
 * settings 는 빌더가 보내는 SurveySettings 형태를 그대로 보존해야 하므로
 * z.custom 으로 타입만 보장한다(세밀 zod 화 시 endDate Date|string 혼용·optional
 * 수식자 차이로 회귀 위험). 출력 SurveyRowSchema 는 db schema Survey($inferSelect)
 * 전체 행을 그대로 통과시킨다.
 */
export const SurveySettingsSchema = z.custom<SurveySettings>();

// ─────────────────────────────────────────────────────────────────────────────
// ensureSurveyInDb
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 설문이 DB 에 존재하는지 확인하고 없으면 최소 레코드 생성(idempotent).
 * settings 는 SurveySettings 전체(원본 surveyData.settings).
 */
export const EnsureSurveyInDbInput = z.object({
  id: z.string(),
  title: z.string(),
  privateToken: z.string().optional(),
  settings: SurveySettingsSchema,
});
export type EnsureSurveyInDbInput = z.infer<typeof EnsureSurveyInDbInput>;

export const EnsureSurveyResultSchema = z.object({
  surveyId: z.string(),
  created: z.boolean(),
});
export type EnsureSurveyResult = z.infer<typeof EnsureSurveyResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// createSurvey
// ─────────────────────────────────────────────────────────────────────────────

/**
 * settings 는 Partial<SurveyType['settings']> — 원본 createSurvey 가
 * settings?.endDate 등 부분 필드만 참조한다. z.custom 으로 타입만 보장.
 */
export const CreateSurveyInput = z.object({
  title: z.string(),
  description: z.string().optional(),
  slug: z.string().optional(),
  isPublic: z.boolean().optional(),
  settings: z.custom<Partial<SurveyType['settings']>>().optional(),
});
export type CreateSurveyInput = z.infer<typeof CreateSurveyInput>;

// ─────────────────────────────────────────────────────────────────────────────
// updateSurvey
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 업데이트 data 는 원본 Partial<{...11필드...}> 형태. endDate 는 Date|null 혼용이라
 * z.custom 으로 타입만 보장하고 service 가 updatedAt 자동 set 한다.
 * 다인자(surveyId, data) -> 단일 input object 로 묶음(oRPC procedure 단일 input).
 */
export const UpdateSurveyDataSchema = z.custom<
  Partial<{
    title: string;
    description: string;
    slug: string;
    isPublic: boolean;
    allowMultipleResponses: boolean;
    showProgressBar: boolean;
    shuffleQuestions: boolean;
    requireLogin: boolean;
    endDate: Date | null;
    piiRetentionUntil: Date | null;
    maxResponses: number | null;
    thankYouMessage: string;
    responseHeader: SurveyType['settings']['responseHeader'];
  }>
>();

export const UpdateSurveyInput = z.object({
  surveyId: z.string(),
  data: UpdateSurveyDataSchema,
});
export type UpdateSurveyInput = z.infer<typeof UpdateSurveyInput>;

// ─────────────────────────────────────────────────────────────────────────────
// deleteSurvey / duplicateSurvey
// ─────────────────────────────────────────────────────────────────────────────

export const SurveyIdInput = z.object({
  surveyId: z.string(),
});
export type SurveyIdInput = z.infer<typeof SurveyIdInput>;

export const DeleteSurveyOutput = z.void();

/** db schema Survey 행 전체. */
export const SurveyRowSchema = z.custom<SurveyRow>();

/** duplicateSurvey 는 원본 not found 시 null 반환(404 표현). */
export const DuplicateResultSchema = SurveyRowSchema.nullable();
