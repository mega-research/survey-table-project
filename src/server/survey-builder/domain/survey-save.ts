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

/**
 * payload 가 **다른 설문 소유의 질문·그룹 id** 를 들고 왔다 (Codex 리뷰).
 *
 * 저장 관문은 부모 surveyId 의 `survey.edit` 만 본다. 그 다음 하위 행은 전역 PK 로만
 * 지워지고 덮어써졌기 때문에, 편집 권한이 있는 설문의 payload 에 타 팀 설문의 질문 id 를
 * 섞으면 그 질문이 삭제되거나 내용이 바뀌었다. 새 id 는 정상 삽입이므로 이 에러는 "그 id 가
 * 다른 설문에 실재한다" 는 뜻이고, 그 사실을 아는 것 자체가 이미 id 를 손에 넣었다는 뜻이라
 * 조용히 넘기는 것보다 거절이 낫다.
 */
export class CrossSurveyRowError extends Error {
  constructor(public readonly kind: 'question' | 'group') {
    super(
      kind === 'question'
        ? '다른 설문의 질문은 이 설문에서 수정할 수 없습니다.'
        : '다른 설문의 그룹은 이 설문에서 수정할 수 없습니다.',
    );
    this.name = 'CrossSurveyRowError';
  }
}
