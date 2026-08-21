// 설문 빌더·응답 경계 계약 — UI 와 서버가 주고받는 입출력 모양.
// 같은 폴더의 survey.ts — DB 에 저장되는 JSONB 문서 어휘. 이 파일 — 서버와 UI 사이 경계를 건너는 모양.
// client-safe — server-only·Node·DB 의존 없음. 질문 구조 타입은 @/types/survey 소관이라 빌려 쓴다.
import type { Question, QuestionGroup, SurveySettings } from '@/types/survey';

/**
 * Diff 기반 설문 저장(saveSurveyDiff) 페이로드.
 *
 * groups/questionChanges.upserted 는 24+ 필드 다형 JSONB(tableColumns·displayCondition·
 * rankingConfig 등)라 서버 zod 는 z.custom 으로 타입만 보장한다. 세밀 zod 화 시 explicit field
 * set·직렬화가 깨지므로 원본은 타입만 신뢰하고 service 가 explicit field set 으로 DB 에 매핑한다.
 */
export interface SurveyDiffPayload {
  surveyId: string;
  metadata?: {
    title: string;
    description?: string;
    slug?: string;
    privateToken?: string;
    contactEmail?: string | null;
    settings: SurveySettings;
    thankYouMessage?: string;
  };
  groups?: QuestionGroup[];
  questionChanges?: {
    upserted: Question[]; // 추가 + 수정된 질문 (전체 객체)
    deleted: string[]; // 삭제된 질문 ID
    reorderedIds?: string[]; // 전체 질문 ID 순서 (순서 변경 시에만)
  };
}

/**
 * 응답 페이지 첫 화면 게이트용 라이브 제어값. snapshot 밖 값이므로 항상 현재
 * surveys 행에서 읽는다 — publish 이전에도 즉시 반영돼야 하는 운영 스위치.
 */
export type SurveyControl = {
  isPaused: boolean;
  pausedMessage: string | null;
  testSession: 'none' | 'valid' | 'invalid';
  testSessionKind: 'anonymous' | 'target' | null;
};
