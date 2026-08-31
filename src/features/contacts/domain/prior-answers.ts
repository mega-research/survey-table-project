import * as z from 'zod';

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
  headerRow: z.number().optional(),
});
export type SuggestPriorAnswerMappingInput = z.infer<typeof SuggestPriorAnswerMappingInput>;

export const SuggestPriorAnswerMappingResultSchema = z.object({
  sheetNames: z.array(z.string()),
  headers: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.string())),
  totalRows: z.number(),
  /** 컬럼 키 → 제안 문항 (없으면 null) */
  suggestions: z.array(
    z.object({
      columnKey: z.string(),
      questionId: z.string().nullable(),
      matchedBy: z.literal('code').nullable(),
    }),
  ),
  /** 이 경로가 값을 넣을 수 있는 문항 목록 — 화면의 수동 매핑 선택지. */
  questions: z.array(
    z.object({
      id: z.string(),
      questionCode: z.string().nullable(),
      title: z.string(),
      type: z.string(),
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
  headerRow: z.number(),
  /** 조사 대상을 찾을 열 — 설문별 자동 발번 번호(시스템ID) */
  residColumnKey: z.string(),
  /** 컬럼 키 → 문항 id */
  mapping: z.record(z.string(), z.string()),
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
  /** 매핑되지 않은 컬럼 키 */
  unmappedColumns: z.array(z.string()),
  /** 이월 값이 하나도 들어가지 않은 문항 id */
  questionsWithoutValues: z.array(z.string()),
  /** 이 경로가 다룰 수 없는 문항으로 매핑된 것 */
  unsupportedQuestionIds: z.array(z.string()),
  /** 문항별 선택지 변환 실패 */
  optionMismatches: z.array(
    z.object({
      questionId: z.string(),
      total: z.number(),
      unmatched: z.number(),
      values: z.array(z.object({ value: z.string(), count: z.number() })),
    }),
  ),
});
export type ImportPriorAnswersResult = z.infer<typeof ImportPriorAnswersResultSchema>;
