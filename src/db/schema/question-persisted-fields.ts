import type { NewQuestion } from '@/db/schema';

/**
 * 질문 영속 쓰기 채널(explicit field set — spread 금지, 불변식 A)이 반드시 다뤄야 하는 컬럼 키.
 *
 * 신규 컬럼 추가 절차: 여기 등재하면 모든 쓰기 채널이 누락을 컴파일 에러로 호명한다 —
 * - 완전 쓰기(insert/upsert): `satisfies CompleteQuestionWrite` 부착 지점
 *   (survey-save 의 values/onConflictDoUpdate, questions.create, duplicateSurvey)
 * - 부분 쓰기(patch): questions.service updateQuestion 의 SSOT 순회
 *   (data[field] 인덱스 접근이 UpdateQuestionData 스키마 누락을 호명)
 * "신규 컬럼 시 양쪽 점검" 수동 절차의 tsc 관할화.
 *
 * id/surveyId/createdAt/updatedAt 은 지점별 소유(생성·충돌 처리 방식이 다름)라 제외.
 * imageUrl/videoUrl 은 레거시 미영속 컬럼이라 제외.
 */
export const PERSISTED_QUESTION_FIELDS = [
  'groupId',
  'type',
  'title',
  'description',
  'required',
  'order',
  'options',
  'selectLevels',
  'tableTitle',
  'tableColumns',
  'tableRowsData',
  'tableHeaderGrid',
  'allowOtherOption',
  'optionsColumns',
  'optionsAlign',
  'minSelections',
  'maxSelections',
  'noticeContent',
  'requiresAcknowledgment',
  'placeholder',
  'defaultValueTemplate',
  'inputType',
  'emptyDefault',
  'numberFormat',
  'piiEncrypted',
  'tableValidationRules',
  'sumConstraints',
  'dynamicRowConfigs',
  'hideColumnLabels',
  'mobileOriginalTable',
  'mobileTableDisplayMode',
  'mobileDrilldownOmitLeadingColumns',
  'hideTitle',
  'pageBreakBefore',
  'rankingConfig',
  'choiceGroups',
  'displayCondition',
  'questionCode',
  'isCustomSpssVarName',
  'exportLabel',
  'spssVarType',
  'spssMeasure',
] as const satisfies readonly (keyof NewQuestion)[];

export type PersistedQuestionField = (typeof PERSISTED_QUESTION_FIELDS)[number];

/**
 * 쓰기 객체 literal 에 `satisfies CompleteQuestionWrite` 로 부착한다.
 * 영속 필드 누락은 컴파일 에러, 지점별 추가 키(id/surveyId/updatedAt 등)는
 * index signature 가 흡수해 허용된다. 값 타입 검증은 drizzle 의 NewQuestion
 * 컨텍스트 타이핑이 그대로 수행한다.
 */
export type CompleteQuestionWrite = Record<PersistedQuestionField, unknown> &
  Record<string, unknown>;

// 역방향 검사 — questions 테이블에 새 컬럼이 생기면 아래 return 할당이 컴파일 에러가
// 되어 PERSISTED_QUESTION_FIELDS 등재(또는 의도적 제외 목록 갱신)를 강제한다.
export function toPersistedQuestionField(
  column: Exclude<
    keyof NewQuestion,
    'id' | 'surveyId' | 'createdAt' | 'updatedAt' | 'imageUrl' | 'videoUrl'
  >,
): PersistedQuestionField {
  return column;
}
