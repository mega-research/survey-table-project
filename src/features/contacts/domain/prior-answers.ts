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
  /** 헤더로 읽을 행 수. 3 이면 파트/문항코드/세부라벨 3단 병합 헤더. */
  headerRowCount: z.number().int().min(1).max(3).optional(),
});
export type SuggestPriorAnswerMappingInput = z.infer<typeof SuggestPriorAnswerMappingInput>;

export const SuggestPriorAnswerMappingResultSchema = z.object({
  sheetNames: z.array(z.string()),
  /** 헤더 행 격자 — 컬럼 인덱스 순서 그대로, 병합 종속 칸은 빈 문자열. */
  headerRows: z.array(z.array(z.string())),
  /** 표본 데이터 행 — 컬럼 인덱스 순서 그대로. */
  rows: z.array(z.array(z.string())),
  totalRows: z.number(),
  /** 문항코드 행에서 잘라낸 컬럼 블록과 자동 제안. 배열 인덱스가 곧 블록 번호다. */
  blocks: z.array(
    z.object({
      code: z.string(),
      part: z.string(),
      columnIndexes: z.array(z.number()),
      detailLabels: z.array(z.string()),
      questionId: z.string().nullable(),
      matchedBy: z.literal('code').nullable(),
      unmatchedSlots: z.number(),
    }),
  ),
  /** 화면의 수동 매핑 선택지. */
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
  /** 헤더로 읽을 행 수 (1~3). */
  headerRowCount: z.number().int().min(1).max(3),
  /** 조사 대상을 찾을 컬럼 인덱스 — 설문별 자동 발번 번호(시스템ID) */
  residColumnIndex: z.number().int().min(0),
  /** 블록 번호(문자열) → 문항 id */
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
  /** 잇지 않은 블록의 문항코드 */
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
