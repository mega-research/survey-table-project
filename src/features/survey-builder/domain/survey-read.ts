import * as z from 'zod';

import type {
  Question as QuestionRow,
  QuestionGroup as QuestionGroupRow,
  Survey as SurveyRow,
  SurveyResponse,
  SurveyVersion,
} from '@/db/schema';
import type { VariableDef } from '@/components/operations/mail-template/variable-catalog';
import type { Survey as SurveyType } from '@/types/survey';

// types/survey 의 SurveyType(컴포넌트 기대 타입)과 DB row 타입을 함께 re-export.
// 런타임 import 0 — 전부 type-only.
export type { SurveyRow, SurveyResponse, SurveyVersion, QuestionRow, QuestionGroupRow };
export type { SurveyType };
export type { VariableDef };

// ─────────────────────────────────────────────────────────────────────────────
// 공통 input
// ─────────────────────────────────────────────────────────────────────────────

/** surveyId 단일 input. */
export const SurveyIdInput = z.object({ surveyId: z.string() });
export type SurveyIdInput = z.infer<typeof SurveyIdInput>;

/** responseId + surveyId input. WS-2 IDOR 봉인: 응답 단건 조회는 설문 스코프를 함께 받는다. */
export const ResponseIdInput = z.object({ responseId: z.string(), surveyId: z.string() });
export type ResponseIdInput = z.infer<typeof ResponseIdInput>;

// ─────────────────────────────────────────────────────────────────────────────
// list (getSurveyListWithCounts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 설문 목록 요약 한 행. 목록 화면이 쓰는 survey projection 과 응답 집계만 포함한다.
 */
export type SurveyListItem = {
  id: string;
  title: string;
  description: string | null;
  slug: string | null;
  privateToken: string | null;
  responseCount: number;
  completedResponseCount: number;
  createdAt: Date;
  updatedAt: Date;
  isPublic: boolean;
};
export const SurveyListItemSchema = z.custom<SurveyListItem>();
export const SurveyListOutput = z.array(SurveyListItemSchema);

// ─────────────────────────────────────────────────────────────────────────────
// byId (getSurveyById) — surveys.$inferSelect | undefined
// ─────────────────────────────────────────────────────────────────────────────

/** surveys 행. findFirst 결과라 undefined 가능 → nullable 로 노출. */
export const SurveyRowOutput = z.custom<SurveyRow | null | undefined>();

// ─────────────────────────────────────────────────────────────────────────────
// withDetails (getSurveyWithDetails) — SurveyType | null
// ─────────────────────────────────────────────────────────────────────────────

/** 설문+그룹+질문 복합 조회. 컴포넌트 기대 타입 SurveyType. */
export const SurveyWithDetailsOutput = z.custom<SurveyType | null>();

// ─────────────────────────────────────────────────────────────────────────────
// search (searchSurveys) — SurveyRow[]
// ─────────────────────────────────────────────────────────────────────────────

export const SurveyRowArrayOutput = z.custom<SurveyRow[]>();

// ─────────────────────────────────────────────────────────────────────────────
// slugAvailable (isSlugAvailable)
// ─────────────────────────────────────────────────────────────────────────────

export const SlugAvailableInput = z.object({
  slug: z.string(),
  excludeSurveyId: z.string().optional(),
});
export type SlugAvailableInput = z.infer<typeof SlugAvailableInput>;
export const SlugAvailableOutput = z.boolean();

// ─────────────────────────────────────────────────────────────────────────────
// questionGroups (getQuestionGroupsBySurvey) / questions (getQuestionsBySurvey)
// 각각 db row 배열. 컴포넌트 가공 없이 그대로 통과.
// ─────────────────────────────────────────────────────────────────────────────

export const QuestionGroupRowArrayOutput = z.custom<QuestionGroupRow[]>();
export const QuestionRowArrayOutput = z.custom<QuestionRow[]>();

// ─────────────────────────────────────────────────────────────────────────────
// responsesBySurvey / completedResponses (getResponsesBySurvey, getCompletedResponses)
// ─────────────────────────────────────────────────────────────────────────────

export const SurveyResponseArrayOutput = z.custom<SurveyResponse[]>();

// ─────────────────────────────────────────────────────────────────────────────
// responseById (getResponseById) — SurveyResponse | undefined
// ─────────────────────────────────────────────────────────────────────────────

export const SurveyResponseOutput = z.custom<SurveyResponse | null | undefined>();

// ─────────────────────────────────────────────────────────────────────────────
// responsesWithAnswers (getResponsesWithAnswers)
// versionId optional. 반환은 SurveyResponse + (response_answers 어댑터 변환된) 배열.
// ─────────────────────────────────────────────────────────────────────────────

export const ResponsesWithAnswersInput = z.object({
  surveyId: z.string(),
  versionId: z.string().nullable().optional(),
});
export type ResponsesWithAnswersInput = z.infer<typeof ResponsesWithAnswersInput>;
// 어댑터로 questionResponses 가 덮어써질 수 있으나 SurveyResponse 와 구조 호환.
export const ResponsesWithAnswersOutput = z.custom<SurveyResponse[]>();

// ─────────────────────────────────────────────────────────────────────────────
// surveyVersions (getSurveyVersions) — projection subset
// ─────────────────────────────────────────────────────────────────────────────

/** getSurveyVersions 의 columns 프로젝션 subset. */
export type SurveyVersionListItem = Pick<
  SurveyVersion,
  'id' | 'versionNumber' | 'status' | 'changeNote' | 'publishedAt'
>;
export const SurveyVersionListOutput = z.custom<SurveyVersionListItem[]>();

// ─────────────────────────────────────────────────────────────────────────────
// exportJson / exportCsv — string 반환
// ─────────────────────────────────────────────────────────────────────────────

export const ExportStringOutput = z.string();

// ─────────────────────────────────────────────────────────────────────────────
// allTags (library getAllTags) — string[]
// ─────────────────────────────────────────────────────────────────────────────

export const AllTagsOutput = z.array(z.string());

// ─────────────────────────────────────────────────────────────────────────────
// variableCatalog (getVariableCatalogAction) — VariableDef[]
// ─────────────────────────────────────────────────────────────────────────────

export const VariableCatalogOutput = z.custom<VariableDef[]>();

// ─────────────────────────────────────────────────────────────────────────────
// 공개(pub) 응답자 조회 — bySlug / byPrivateToken / forResponse
// 원본 3함수 모두 requireAuth 없음. 응답자 공개 경로(survey-response-flow).
// ─────────────────────────────────────────────────────────────────────────────

/** bySlug(getSurveyBySlug). 반환 surveys.$inferSelect | undefined → nullable. */
export const SurveyBySlugInput = z.object({ slug: z.string() });
export type SurveyBySlugInput = z.infer<typeof SurveyBySlugInput>;

/** byPrivateToken(getSurveyByPrivateToken). 반환 surveys.$inferSelect | undefined → nullable. */
export const SurveyByPrivateTokenInput = z.object({ token: z.string() });
export type SurveyByPrivateTokenInput = z.infer<typeof SurveyByPrivateTokenInput>;

/** forResponse(getSurveyForResponse) 전용 input. testToken 은 테스트 링크 검증용(옵셔널). */
export const SurveyForResponseInput = SurveyIdInput.extend({
  testToken: z.string().optional(),
});
export type SurveyForResponseInput = z.infer<typeof SurveyForResponseInput>;

/**
 * 응답 페이지 첫 화면 게이트용 라이브 제어값. snapshot 밖 값이므로 항상 현재
 * surveys 행에서 읽는다 — publish 이전에도 즉시 반영돼야 하는 운영 스위치.
 */
export type SurveyControl = {
  isPaused: boolean;
  pausedMessage: string | null;
  testSession: 'none' | 'valid' | 'invalid';
};

/**
 * forResponse(getSurveyForResponse). 반환 { survey, versionId, control } | null.
 * survey 는 SurveyType, versionId 는 배포 버전 id 또는 null(미배포 fallback).
 * control 은 스냅샷 밖 라이브 값(중단 상태 + 테스트 링크 판정).
 */
export type SurveyForResponseResult = {
  survey: SurveyType;
  versionId: string | null;
  control: SurveyControl;
} | null;
export const SurveyForResponseOutput = z.custom<SurveyForResponseResult>();
