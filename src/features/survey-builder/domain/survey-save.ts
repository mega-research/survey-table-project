import * as z from 'zod';

import type {
  Question,
  QuestionGroup,
  Survey as SurveyType,
  SurveySettings,
} from '@/types/survey';

export type { Question, QuestionGroup, SurveyType, SurveySettings };

/**
 * Diff 기반 설문 저장(saveSurveyDiff) + 전체 저장(saveSurveyWithDetails) 도메인 스키마.
 *
 * SurveyDiffPayload 의 groups/questionChanges.upserted 는 24+ 필드 다형 JSONB
 * (tableColumns/displayCondition/rankingConfig 등)라 z.custom<...[]>() 로 타입만 보장.
 * 세밀 zod 화 시 explicit field set·직렬화 깨짐 위험 — 원본은 타입만 신뢰하고
 * service 가 explicit field set 으로 DB 매핑한다.
 *
 * 원본 interface SurveyDiffPayload(src/actions/survey-save-actions.ts) 를 여기서
 * re-export 한다(소비처 use-survey-sync 가 import type).
 */
export interface SurveyDiffPayload {
  surveyId: string;
  metadata?: {
    title: string;
    description?: string;
    slug?: string;
    privateToken?: string;
    contactEmail?: string | null;
    settings: SurveySettings;
    thankYouMessage?: string;
  };
  groups?: QuestionGroup[];
  questionChanges?: {
    upserted: Question[]; // 추가 + 수정된 질문 (전체 객체)
    deleted: string[]; // 삭제된 질문 ID
    reorderedIds?: string[]; // 전체 질문 ID 순서 (순서 변경 시에만)
  };
}

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
