import { describe, expect, it } from 'vitest';

/**
 * Phase 1: 버전 스냅샷 + 응답 정규화 스키마 타입 검증
 *
 * DB 연결 없이 타입 레벨에서 스키마 정의가 올바른지 검증합니다.
 * - survey_versions 테이블 정의 존재
 * - response_answers 테이블 정의 존재
 * - surveys 테이블에 status, currentVersionId, deletedAt 컬럼
 * - survey_responses 테이블에 versionId 컬럼
 */

describe('survey_versions 테이블 정의', () => {
  it('surveyVersions 테이블이 export 되어야 함', async () => {
    const schema = await import('@/db/schema/surveys');
    expect(schema.surveyVersions).toBeDefined();
  });

  it('필수 컬럼들이 정의되어야 함', async () => {
    const schema = await import('@/db/schema/surveys');
    const table = schema.surveyVersions;

    // Drizzle 테이블 객체의 컬럼 확인
    expect(table.id).toBeDefined();
    expect(table.surveyId).toBeDefined();
    expect(table.versionNumber).toBeDefined();
    expect(table.status).toBeDefined();
    expect(table.snapshot).toBeDefined();
    expect(table.changeNote).toBeDefined();
    expect(table.publishedAt).toBeDefined();
    expect(table.closedAt).toBeDefined();
    expect(table.deletedAt).toBeDefined();
    expect(table.createdAt).toBeDefined();
  });
});

describe('response_answers 테이블 정의', () => {
  it('responseAnswers 테이블이 export 되어야 함', async () => {
    const schema = await import('@/db/schema/surveys');
    expect(schema.responseAnswers).toBeDefined();
  });

  it('필수 컬럼들이 정의되어야 함', async () => {
    const schema = await import('@/db/schema/surveys');
    const table = schema.responseAnswers;

    expect(table.id).toBeDefined();
    expect(table.responseId).toBeDefined();
    expect(table.questionId).toBeDefined();
    expect(table.textValue).toBeDefined();
    expect(table.arrayValue).toBeDefined();
    expect(table.objectValue).toBeDefined();
    expect(table.questionType).toBeDefined();
    expect(table.createdAt).toBeDefined();
  });
});

describe('surveys 테이블 확장', () => {
  it('status 컬럼이 추가되어야 함', async () => {
    const schema = await import('@/db/schema/surveys');
    expect(schema.surveys.status).toBeDefined();
  });

  it('currentVersionId 컬럼이 추가되어야 함', async () => {
    const schema = await import('@/db/schema/surveys');
    expect(schema.surveys.currentVersionId).toBeDefined();
  });

  it('deletedAt 컬럼이 추가되어야 함 (soft delete)', async () => {
    const schema = await import('@/db/schema/surveys');
    expect(schema.surveys.deletedAt).toBeDefined();
  });
});

describe('survey_responses 테이블 확장', () => {
  it('versionId 컬럼이 추가되어야 함', async () => {
    const schema = await import('@/db/schema/surveys');
    expect(schema.surveyResponses.versionId).toBeDefined();
  });
});

describe('타입 정의', () => {
  it('SurveyVersion 타입이 export 되어야 함', async () => {
    const types = await import('@/db/schema/surveys');
    // 런타임에서는 테이블 객체가 존재하면 타입도 추론 가능
    expect(types.surveyVersions).toBeDefined();
  });

  it('ResponseAnswer 타입이 export 되어야 함', async () => {
    const types = await import('@/db/schema/surveys');
    expect(types.responseAnswers).toBeDefined();
  });
});
