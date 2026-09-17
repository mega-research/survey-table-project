import * as z from 'zod';

import type { SurveyDiffPayload } from '@/shared/contracts/survey-builder-io';
import type { Question, QuestionGroup, SurveySettings, Survey as SurveyType } from '@/types/survey';

export type { Question, QuestionGroup, SurveyType, SurveySettings };

// 저장 페이로드 모양은 계약(@/shared/contracts/survey-builder-io) 소관 — 여기서 다시 내보내
// 서버 쪽 소비처(service·procedure)의 import 경로를 유지한다.
export type { SurveyDiffPayload };

/**
 * Diff 기반 설문 저장(saveSurveyDiff) + 전체 저장(saveSurveyWithDetails) 도메인 스키마.
 *
 * SurveyDiffPayload 의 groups/questionChanges.upserted 는 24+ 필드 다형 JSONB
 * (tableColumns/displayCondition/rankingConfig 등)라 z.custom<...[]>() 로 타입만 보장.
 * 세밀 zod 화 시 explicit field set·직렬화 깨짐 위험 — 원본은 타입만 신뢰하고
 * service 가 explicit field set 으로 DB 매핑한다.
 *
 * SurveyDiffPayload 모양 자체는 계약(@/shared/contracts/survey-builder-io) 소관이다.
 * 여기서는 그것을 다시 내보내고 zod 경계만 얹는다.
 */
export const SurveyDiffPayloadSchema = z.object({
  surveyId: z.string(),
  metadata: z.custom<SurveyDiffPayload['metadata']>().optional(),
  groups: z.custom<QuestionGroup[]>().optional(),
  questionChanges: z
    .object({
      upserted: z.custom<Question[]>(),
      deleted: z.array(z.string()),
      reorderedIds: z.array(z.string()).optional(),
    })
    .optional(),
});

/**
 * service 입력 타입(rule 4) — zod infer.
 * z.object 의 .optional() 은 prop 을 `T | undefined` 로 추론하므로,
 * exactOptionalPropertyTypes 환경에서 SurveyDiffPayload 인터페이스(명시적 undefined 없음)에
 * 직접 대입할 수 없다. service 는 모든 optional 을 undefined-safe 하게 읽으므로
 * 이 widened 타입을 그대로 받는다(소비처 import 용 SurveyDiffPayload 인터페이스는 유지).
 */
export type SurveyDiffPayloadInput = z.infer<typeof SurveyDiffPayloadSchema>;

/**
 * 전체 설문 저장 입력 — types/survey Survey 전체(신규 생성 전용).
 */
export const SaveSurveyWithDetailsInput = z.custom<SurveyType>();

export const SaveResultSchema = z.object({ surveyId: z.string() });
export type SaveResult = z.infer<typeof SaveResultSchema>;
