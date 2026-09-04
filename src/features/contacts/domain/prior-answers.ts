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
  /**
   * 3행에 이 설문의 SPSS 변수명이 보이는가 — 우리 Raw 양식 자동 추측.
   * 추측일 뿐이고 확정은 사람이 한다.
   */
  looksLikeRawFormat: z.boolean(),
  /** 헤더 행 격자 — 컬럼 인덱스 순서 그대로, 병합 종속 칸은 빈 문자열. */
  headerRows: z.array(z.array(z.string())),
  /** 표본 데이터 행 — 컬럼 인덱스 순서 그대로. */
  rows: z.array(z.array(z.string())),
  totalRows: z.number(),
  /** 문항코드 행에서 잘라낸 컬럼 블록과 자동 제안. 배열 인덱스가 곧 블록 번호다. */
  blocks: z.array(
    z.object({
      code: z.string(),
      /** 문항 내용 대조에 쓴 텍스트 — 담당자가 판정 근거를 볼 수 있어야 한다. */
      label: z.string(),
      part: z.string(),
      columnIndexes: z.array(z.number()),
      detailLabels: z.array(z.string()),
      questionId: z.string().nullable(),
      /** value 는 블록 값이 이 문항의 보기와 맞아 제안된 것 — 코드·제목이 아니라 값으로 잇는다. */
      matchedBy: z.enum(['code', 'label', 'value']).nullable(),
      verdict: z.enum(['auto', 'code-conflict', 'value-conflict', 'label-candidate', 'unmapped']),
      /** code-conflict·value-conflict·value 후보일 때 코드가 가리킨 문항 */
      conflictQuestionId: z.string().nullable(),
      /** 값 적합도 판정의 근거("표본 180건 중 보기와 맞는 값 0건 …") — 화면이 배지 아래 그대로 찍는다. */
      verdictReason: z.string().nullable(),
      /** 확정 설정에서 되살린 매핑인가 — 화면이 "지난 확정" 으로 표시한다. */
      fromSavedConfig: z.boolean(),
      /** 블록 컬럼별 배정 결과. 표 위치 폴백의 조용한 오배정을 눈으로 확인하는 자리다. */
      slotLabels: z.array(z.string()),
      unmatchedSlots: z.number(),
    }),
  ),
  /** 보관된 값 대응 — 화면이 이 상태로 시작해야 지난 확정이 재사용된다. */
  savedValueAliases: z.record(z.string(), z.record(z.string(), z.string())),
  /** 화면의 수동 매핑 선택지. */
  questions: z.array(
    z.object({
      id: z.string(),
      questionCode: z.string().nullable(),
      title: z.string(),
      type: z.string(),
      /** 이 문항의 선택지 — 안 맞은 원본 값을 그 자리에서 이어줄 때 쓴다. */
      options: z.array(z.object({ value: z.string(), label: z.string() })),
    }),
  ),
});
export type SuggestPriorAnswerMappingResult = z.infer<typeof SuggestPriorAnswerMappingResultSchema>;

/**
 * 파일 양식. `raw` 는 우리 Raw Data 내보내기 양식 — 3행 SPSS 변수명으로 열을 잡고
 * 사람이 잇지 않는다. `mapped` 는 임의 엑셀 — 문항코드 블록을 사람이 이어준다.
 */
export const PriorAnswerSheetFormat = z.enum(['raw', 'mapped']);
export type PriorAnswerSheetFormat = z.infer<typeof PriorAnswerSheetFormat>;

export const ImportPriorAnswersInput = z.object({
  surveyId: z.string(),
  file: z.instanceof(File),
  sheetName: z.string(),
  /** 헤더로 읽을 행 수 (1~3). raw 양식은 항상 3 이다. */
  headerRowCount: z.number().int().min(1).max(3),
  /** 파일 양식. 미지정은 기존 경로(mapped). */
  format: PriorAnswerSheetFormat.optional(),
  /** 대조값이 들어 있는 엑셀 컬럼 인덱스 */
  matchColumnIndex: z.number().int().min(0),
  /**
   * 그 값을 맞출 조사 대상 명단의 attrs 키 (예: `UID`).
   * 시스템ID·pii 는 후보가 아니다 — 클라이언트 파일에는 우리 시스템ID 가 없고,
   * pii 는 암호문이라 대조에 쓰려면 blind index 경로를 타야 한다.
   */
  matchAttrsKey: z.string().min(1),
  /** 블록 번호(문자열) → 문항 id. raw 양식에서는 쓰지 않는다. */
  mapping: z.record(z.string(), z.string()),
  /**
   * 이번 화면에서 이어준 값 대응 — 문항 id → { 원본 값 → 선택지 저장값 }.
   * 요청에 실려 오므로 미리보기가 서버 설정을 건드리지 않고도 결과에 반영된다.
   */
  valueAliases: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  /** true 면 적재하지 않고 결과만 계산한다 (실행 전 미리보기). */
  dryRun: z.boolean().optional(),
});
export type ImportPriorAnswersInput = z.infer<typeof ImportPriorAnswersInput>;

export const ImportPriorAnswersResultSchema = z.object({
  /** 시트에서 값이 만들어진 조사 대상 수 */
  parsedTargets: z.number(),
  /** 그중 명단에서 찾아 이월 응답을 붙인 수 */
  matched: z.number(),
  /** 명단에서 찾지 못한 대조값 (최대 50건 절단) */
  unmatchedMatchValues: z.array(z.string()),
  unmatched: z.number(),
  /** 대조값이 비어 버린 행 수 */
  emptyMatchRows: z.number(),
  /** 올린 파일 안에서 두 번 이상 나와 통째로 뺀 대조값 (최대 50건 절단) */
  duplicateMatchValues: z.array(z.string()),
  /** 명단 쪽에 같은 값을 가진 조사 대상이 둘 이상이라 통째로 뺀 대조값 (최대 50건 절단) */
  ambiguousMatchValues: z.array(z.string()),
  /** 위 둘로 빠진 대조값 총수 (절단 전) */
  skippedAmbiguous: z.number(),
  /** 잇지 않은 블록의 문항코드 (mapped 양식 전용) */
  unmappedColumns: z.array(z.string()),
  /** raw 양식 — 이 설문의 변수명과 맞지 않아 건너뛴 열 (최대 50건 절단) */
  unknownVarNames: z.array(z.string()),
  /** raw 양식 — 규칙상 되읽지 않는 열(변동 확인·공지 동의) */
  skippedByRuleVarNames: z.array(z.string()),
  /** raw 양식 — 아직 되돌릴 수 없는 열 종류 */
  unsupportedVarNames: z.array(z.string()),
  /** 이월 값이 하나도 들어가지 않은 문항 id */
  questionsWithoutValues: z.array(z.string()),
  /** 이 경로가 다룰 수 없는 문항으로 매핑된 것 */
  unsupportedQuestionIds: z.array(z.string()),
  /** 문항별 선택지 변환 실패. 실패율 내림차순 — 경고 수십 줄에 묻히지 않게. */
  optionMismatches: z.array(
    z.object({
      questionId: z.string(),
      total: z.number(),
      unmatched: z.number(),
      /** unmatched / total (0~1) */
      rate: z.number(),
      values: z.array(z.object({ value: z.string(), count: z.number() })),
    }),
  ),
});
export type ImportPriorAnswersResult = z.infer<typeof ImportPriorAnswersResultSchema>;

/** 확정 매핑·값 대응 저장 — 다시 올릴 때 그대로 재사용된다. */
export const SavePriorAnswerImportConfigInput = z.object({
  surveyId: z.string(),
  /** 정규화된 문항코드 → 확정 문항 id + 그때의 문항 내용 */
  blockMappings: z.record(z.string(), z.object({ questionId: z.string(), label: z.string() })),
  /** 문항 id → { 원본 값 → 선택지 저장값 } */
  valueAliases: z.record(z.string(), z.record(z.string(), z.string())),
});
export type SavePriorAnswerImportConfigInput = z.infer<typeof SavePriorAnswerImportConfigInput>;
