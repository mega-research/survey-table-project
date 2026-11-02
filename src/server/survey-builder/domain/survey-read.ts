import * as z from 'zod';

import type {
  QuestionGroup as QuestionGroupRow,
  Question as QuestionRow,
  SurveyResponse,
  Survey as SurveyRow,
  SurveyVersion,
} from '@/db/schema';
import type { SurveyDocumentView } from '@/shared/contracts/survey-builder-io';
import {
  type SurveyControl,
  type SurveyListItem,
  SurveyListPageInputSchema,
  type SurveyListPageResult,
  type SurveyListResult,
  SurveySuggestInputSchema,
  type SurveySuggestion,
  type SurveySummaryItem,
} from '@/shared/contracts/survey-builder-io';
import type { VariableDef } from '@/shared/contracts/template-variables';
import type { Survey as SurveyType } from '@/types/survey';

export type { SurveyDocumentView };

// types/survey 의 SurveyType(컴포넌트 기대 타입)과 DB row 타입을 함께 re-export.
// 런타임 import 0 — 전부 type-only.
export type { SurveyRow, SurveyResponse, SurveyVersion, QuestionRow, QuestionGroupRow };
export type { SurveyType };
export type { VariableDef };
// 응답 게이트 제어값 모양은 계약(@/shared/contracts/survey-builder-io) 소관 — 여기서 다시 내보낸다.
export type { SurveyControl };

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
// 목록 행 · 전체 목록 결과 (getSurveyListWithCounts — 분석 페이지 RSC 가 직접 부른다)
// ─────────────────────────────────────────────────────────────────────────────

// 행·응답 모양은 UI(목록 화면·상세 검색)도 쓰므로 계약 소관 — 여기서 다시 내보낸다(티켓 08).
export type { SurveyListItem, SurveyListResult };

// ─────────────────────────────────────────────────────────────────────────────
// listPage (listSurveyPage) — 서버 페이지네이션 (설문 즐겨찾기·태그 티켓 03)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 입력 스키마는 계약 소관이다 — 화면의 주소 ↔ 조건 변환이 같은 어휘를 써야 해서. 요청 객체는
 * DB 쓰기로 가지 않고 `.strict()` 라 모르는 키는 거부된다.
 */
export const SurveyListPageInput = SurveyListPageInputSchema;
export type SurveyListPageInput = z.infer<typeof SurveyListPageInput>;
export type { SurveyListPageResult };
export const SurveyListPageOutput = z.custom<SurveyListPageResult>();

// ─────────────────────────────────────────────────────────────────────────────
// listSummaries (listSurveySummaries) — 사이드바 참여 트리용, 응답 수 없음
// ─────────────────────────────────────────────────────────────────────────────

export type { SurveySummaryItem };

/** 요약 조회 입력 — 목록과 같은 작업 범위 값. 휴지통 모드는 없다(사이드바는 보이는 설문만 센다). */
export const SurveySummaryListInput = z.object({ scope: z.string().nullish() });
export type SurveySummaryListInput = z.infer<typeof SurveySummaryListInput>;

export const SurveySummaryListOutput = z.custom<SurveySummaryItem[]>();

// ─────────────────────────────────────────────────────────────────────────────
// suggest (suggestSurveys) — 자동완성 설문 후보, 응답 수 없음 (설문 즐겨찾기·태그 티켓 05)
// ─────────────────────────────────────────────────────────────────────────────

/** 입력 스키마는 계약 소관 — 검색어 상한을 목록 조건과 공유한다. `.strict()`. */
export const SurveySuggestInput = SurveySuggestInputSchema;
export type SurveySuggestInput = z.infer<typeof SurveySuggestInput>;
export type { SurveySuggestion };
export const SurveySuggestOutput = z.custom<SurveySuggestion[]>();

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

/** bySlug(getSurveyBySlug). */
export const SurveyBySlugInput = z.object({ slug: z.string() });
export type SurveyBySlugInput = z.infer<typeof SurveyBySlugInput>;

/** byPrivateToken(getSurveyByPrivateToken). */
export const SurveyByPrivateTokenInput = z.object({ token: z.string() });
export type SurveyByPrivateTokenInput = z.infer<typeof SurveyByPrivateTokenInput>;

/** byPreviewToken(getSurveyByPreviewToken) — 공개 읽기전용 미리보기 라우트(/preview/[token]) 전용. */
export const SurveyByPreviewTokenInput = z.object({ token: z.string() });
export type SurveyByPreviewTokenInput = z.infer<typeof SurveyByPreviewTokenInput>;

/**
 * bySlug / byPrivateToken / byPreviewToken 반환. 세 pub 절차는 익명 응답자에게 노출되므로
 * full row 를 반환하면 testToken/testModeEnabled/isPaused/pausedMessage/privateToken 같은
 * 라이브 제어·비밀 컬럼이 유출된다(I-3). 호출자(응답 로더 use-survey-loader, 미리보기 라우트)는
 * id 만 소비하므로 id 만 투영해 반환한다. findFirst 미스 시 undefined → nullable.
 */
export type SurveyIdRow = { id: string };
export const SurveyIdRowOutput = z.custom<SurveyIdRow | null | undefined>();

/** forResponse 전용 input. testToken/inviteToken은 서버 테스트 세션 판정용(옵셔널). */
export const SurveyForResponseInput = SurveyIdInput.extend({
  testToken: z.string().optional(),
  inviteToken: z.string().optional(),
});
export type SurveyForResponseInput = z.infer<typeof SurveyForResponseInput>;

/**
 * forResponse(getSurveyForResponse). 반환 { survey, versionId, control, documentView } | null.
 * survey 는 SurveyType, versionId 는 배포 버전 id 또는 null(미배포 fallback).
 * control 은 스냅샷 밖 라이브 값(중단 상태 + 테스트 링크 판정).
 */
export type SurveyForResponseResult = {
  survey: SurveyType;
  versionId: string | null;
  control: SurveyControl;
  documentView: SurveyDocumentView | null;
} | null;
export const SurveyForResponseOutput = z.custom<SurveyForResponseResult>();
