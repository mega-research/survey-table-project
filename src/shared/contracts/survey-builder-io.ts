// 설문 빌더·응답 경계 계약 — UI 와 서버가 주고받는 입출력 모양.
// 같은 폴더의 survey.ts — DB 에 저장되는 JSONB 문서 어휘. 이 파일 — 서버와 UI 사이 경계를 건너는 모양.
// client-safe — server-only·Node·DB 의존 없음. 질문 구조 타입은 @/types/survey 소관이라 빌려 쓴다.
import type { Question, QuestionGroup, Survey, SurveySettings } from '@/types/survey';

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

/**
 * 라우트가 서버에서 미리 조회해 응답 페이지에 넘기는 진입 자료.
 *
 * 짧은 초대 링크(/i/<code>)는 이미 서버 컴포넌트다. 거기서 설문과 컨택 attrs 까지 조회해
 * 넘기면 응답자가 첫 화면을 보기까지의 순차 왕복이 사라진다.
 *
 * **판정은 여기 담지 않는다.** 서버는 조회만 하고, 설문 없음·비공개·초대 필수·무효 토큰
 * 같은 분기는 종전대로 클라이언트 로더가 한 곳에서 내린다 — 분기를 서버에도 복제하면
 * 두 진입 경로가 조용히 갈라진다.
 */
export interface ResponseEntrySeed {
  /** forResponse 조회 결과. null 이면 설문 없음(로더가 기존 에러 화면을 낸다). */
  forResponse: { survey: Survey; versionId: string | null; control: SurveyControl } | null;
  /** attrs 조회 결과. 무효 토큰이면 null — 로더가 기존과 같이 익명 폴백한다. */
  contactAttrs: Record<string, string> | null;
  /** attrs 조회가 테스트 링크 만료로 거부됐다(RPC 의 INVALID_TEST_LINK 와 같은 뜻). */
  attrsInvalidTest?: boolean;
}
