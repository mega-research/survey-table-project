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
  /** 화면이 보고 있던 작업 범위 — 새 설문이 붙을 팀. 서버가 다시 판정한다(티켓 07). */
  scope: z.string().nullish(),
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
  /** 화면이 보고 있던 작업 범위 — 새 설문이 붙을 팀. 서버가 다시 판정한다(티켓 07). */
  scope: z.string().nullish(),
});
export type CreateSurveyInput = z.infer<typeof CreateSurveyInput>;

// ─────────────────────────────────────────────────────────────────────────────
// updateSurvey
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 업데이트 data — **allowlist 다.**
 *
 * 이 스키마가 통과시키는 키가 곧 갱신 가능한 컬럼이다. 예전에는 `z.custom<Partial<{...}>>()`
 * 이었는데 z.custom 은 검증 함수를 주지 않으면 **런타임에 아무것도 보지 않는다** — 타입만
 * 있고 값은 그대로 흘렀다. 서비스가 그 객체를 drizzle `.set()` 에 펼치므로 `survey.edit` 만
 * 가진 팀원이 raw RPC 로 `ownerUserId` 를 실어 보내면 소유자가 되어 FULL_CAPS 로 승격하고,
 * `deletedAt` 을 실으면 TEAM_MEMBER_CAPS 에 없는 `survey.delete` 관문까지 우회했다.
 * `teamId`·`assignmentStatus`·`visibility`·`surveyGroupId` 도 같은 경로였다.
 *
 * `.strict()` 인 이유는 조용히 버리지 않기 위해서다 — 권한 컬럼을 실어 보낸 요청은
 * BAD_REQUEST 로 되돌아가야 로그에 남는다. 서비스도 허용 필드만 명시 set 해 두 겹으로 막는다.
 *
 * `responseHeader` 만 z.custom 으로 남긴다. 판별 유니온이라 zod 로 옮기면 타입과 드리프트가
 * 생기고, 값은 JSONB 컬럼으로만 가서 권한에 닿지 않으며 읽는 쪽이 정규화한다
 * (`normalizeResponseHeaderConfig`, JSONB 드리프트 관례).
 */
export const UpdateSurveyDataSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    slug: z.string().optional(),
    isPublic: z.boolean().optional(),
    allowMultipleResponses: z.boolean().optional(),
    showProgressBar: z.boolean().optional(),
    shuffleQuestions: z.boolean().optional(),
    requireLogin: z.boolean().optional(),
    // Date 와 ISO 문자열이 모두 들어온다 — 컬럼이 Date 를 원하므로 여기서 접는다.
    endDate: z.coerce.date().nullable().optional(),
    maxResponses: z.number().int().nullable().optional(),
    thankYouMessage: z.string().optional(),
    responseHeader: z.custom<SurveyType['settings']['responseHeader']>().optional(),
  })
  .strict();
export type UpdateSurveyData = z.infer<typeof UpdateSurveyDataSchema>;

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

/**
 * 소유 팀을 정할 수 없어 설문을 만들 수 없다 — 화면은 팀을 먼저 고르라고 안내한다.
 *
 * 에러가 도메인에 사는 이유는 이걸 던지는 곳(services)과 RPC 어휘로 옮기는 곳(procedures)이
 * 달라서다. 서비스가 소유하면 procedure 가 에러 하나 때문에 남의 서비스 파일을 import 한다.
 */
export class SurveyOwnershipRequiredError extends Error {
  constructor() {
    super('설문을 만들려면 소유 팀을 먼저 선택해야 합니다.');
    this.name = 'SurveyOwnershipRequiredError';
  }
}
