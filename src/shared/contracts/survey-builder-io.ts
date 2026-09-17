// 설문 빌더·응답 경계 계약 — UI 와 서버가 주고받는 입출력 모양.
// 같은 폴더의 survey.ts — DB 에 저장되는 JSONB 문서 어휘. 이 파일 — 서버와 UI 사이 경계를 건너는 모양.
// client-safe — server-only·Node·DB 의존 없음. 질문 구조 타입은 @/types/survey 소관이라 빌려 쓴다.
import type { Question, QuestionGroup, Survey, SurveySettings } from '@/types/survey';
import type { SurveyAnchorSnapshot } from './survey-document';

import type { SurveyAssignmentStatus, SurveyVisibility, WorkScope } from './workspace';

// ─────────────────────────────────────────────────────────────────────────────
// surveys.status — 설문 수명 상태 (컬럼 어휘)
// ─────────────────────────────────────────────────────────────────────────────
//
// 'closed' 는 미구현 어휘다 — 쓰는 경로가 없고 프로덕션에도 0건이다(조사 종료는 endDate·
// isPaused 로 한다). 목록 상태 칩(.pen FLOW 6)이 세 값을 다 그리므로 어휘에는 남긴다.

export const surveyStatusValues = ['draft', 'published', 'closed'] as const;
export type SurveyStatus = (typeof surveyStatusValues)[number];

/** DB text 컬럼 값을 어휘로 접는다 — 모르는 값은 draft 로(로더 정규화 관례, 캐스트 금지). */
export function normalizeSurveyStatus(value: string): SurveyStatus {
  return value === 'published' || value === 'closed' ? value : 'draft';
}

// ─────────────────────────────────────────────────────────────────────────────
// 설문 목록 (surveyBuilder.read.list) — 티켓 07 도입, 티켓 08 확장
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 설문 목록 요약 한 행. 목록 화면이 쓰는 survey projection 과 응답 집계만 포함한다.
 *
 * owner 두 필드는 화면 편의다 — 카드의 「작성자」 표기와 상세 검색 소유자 필터,
 * 그리고 수정·삭제 버튼의 노출 근사(canEditSurveyCard)에 쓴다. 실제 판정은 언제나
 * 서버 capability 엔진이 한다(티켓 07).
 */
export interface SurveyListItem {
  id: string;
  title: string;
  description: string | null;
  slug: string | null;
  privateToken: string | null;
  responseCount: number;
  completedResponseCount: number;
  createdAt: Date;
  updatedAt: Date;
  /** 마감일 — 상세 검색 기간 필터의 「마감일」 기준. */
  endDate: Date | null;
  isPublic: boolean;
  status: SurveyStatus;
  /** 소속 팀. 배치 대기 설문은 null 이다(티켓 07). */
  teamId: string | null;
  teamName: string | null;
  visibility: SurveyVisibility;
  assignmentStatus: SurveyAssignmentStatus;
  /** 소유자. 0116 2단계 배포 중이라 옛 설문은 null 일 수 있다. */
  ownerUserId: string | null;
  ownerName: string | null;
  /**
   * 소속 그룹 (null = 미분류, 티켓 12).
   *
   * 그룹은 접근이 아니라 정리용 묶음이라 목록 조회 조건이 아니다 — 화면이 이 값으로
   * 그룹 화면(`?group=<id>`)을 좁히고 카드 케밥의 현재 그룹을 표시한다. 소속 팀이 다른
   * 그룹 id 는 서버가 null 로 접어 보낸다.
   */
  surveyGroupId: string | null;
  /**
   * 삭제 시각 — **삭제됨 목록에서만** 채워진다(티켓 17).
   *
   * 일반 목록의 행은 언제나 null 이다(조회 조건이 `deleted_at IS NULL`). 그래서 화면은
   * 이 값 하나로 「지금 휴지통을 보고 있는가」를 알 수 있고, 카드가 복구 액션으로 갈린다.
   */
  deletedAt: Date | null;
  /**
   * 내가 이 설문의 참여자인가 (티켓 18).
   *
   * 카드의 버튼 노출 근사가 본다 — 참여자는 `responses.view` 를 갖지만 팀원은 못 가지므로,
   * 이 값이 없으면 초대받은 사람에게 「분석」이 잠긴 채로 보인다. 판정은 언제나 서버가 한다.
   */
  isParticipant: boolean;
  /** 그 참여가 full 등급인가 (0123) — 제한 참여자는 분석(responses.view)이 없다. */
  isFullParticipant: boolean;
}

/**
 * 목록 응답 — 설문뿐 아니라 **어느 범위로 해석됐는지**와 고를 수 있는 범위를 함께 준다.
 *
 * 화면이 요청한 범위와 서버가 해석한 범위는 다를 수 있다(해산된 팀 쿠키 등). 해석 결과를
 * 돌려주지 않으면 스위처가 실제로 보고 있는 것과 다른 팀을 가리킨 채로 남는다.
 */
export interface SurveyListResult {
  scope: WorkScope;
  /** 고를 수 있는 팀 — 내 활성 소속. 슈퍼어드민은 전 팀. */
  teams: { id: string; name: string }[];
  /** 「메가리서치」(시스템 전체 보기)를 고를 수 있는가. */
  canSeeSystemScope: boolean;
  surveys: SurveyListItem[];
  /**
   * 삭제된 설문 건수 — **null 이면 이 화면에 휴지통이 없다**(티켓 17).
   *
   * 숫자가 아니라 null 로 부재를 말하는 것은, 화면이 「0건짜리 휴지통 칩」과 「휴지통을 볼 수
   * 없는 사람」을 갈라야 하기 때문이다. 채워지는 것은 슈퍼어드민의 시스템 전체 보기뿐이다 —
   * 삭제된 설문은 팀 경계로 좁힐 수 없어(해산된 팀의 것일 수도 있다) 팀 화면에 둘 자리가 없다.
   */
  deletedCount: number | null;
}

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
  /** 추적조사의 이전 회차 라벨(surveys.prior_wave_label). 없으면 null */
  priorWaveLabel: string | null;
  /**
   * 문항별 변동 확인 사용 여부. 스냅샷 밖 라이브 값이라 control 로 흘린다.
   * false 면 응답 화면이 이월 값을 표시되는 문항의 답으로 미리 깔고, 잠금·확인 컨트롤을
   * 띄우지 않는다. true 면 지금까지의 동작 그대로다.
   */
  changeConfirmEnabled: boolean;
};

/**
 * 응답 화면이 조사표 분할로 뜰 때 필요한 것 전부 — PDF 주소·쪽 수·발행 시점에 얼린 앵커.
 * 조사표가 없거나 앵커가 하나도 없으면 null — 그 설문은 분할이 아니다.
 */
export type SurveyDocumentView = {
  url: string;
  pageCount: number;
  anchors: SurveyAnchorSnapshot[];
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
  forResponse: {
    survey: Survey;
    versionId: string | null;
    control: SurveyControl;
    documentView: SurveyDocumentView | null;
  } | null;
  /** attrs 조회 결과. 무효 토큰이면 null — 로더가 기존과 같이 익명 폴백한다. */
  contactAttrs: Record<string, string> | null;
  /** attrs 조회가 테스트 링크 만료로 거부됐다(RPC 의 INVALID_TEST_LINK 와 같은 뜻). */
  attrsInvalidTest?: boolean;
}
