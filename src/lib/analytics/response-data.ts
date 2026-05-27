/**
 * 응답 데이터 공용 타입
 *
 * DB에서 조회한 survey response를 내보내기/클리닝 계층이 소비하는 정규 형태.
 * semi-long / cleaning export 및 analytics dashboard에서 공유한다.
 */

export interface ResponseData {
  id: string;
  surveyId: string;
  questionResponses: Record<string, unknown>;
  isCompleted: boolean;
  startedAt: Date;
  completedAt?: Date;
  userAgent?: string;
  sessionId?: string;
}
