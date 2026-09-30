/**
 * 스펙 §8 의 **주체별 capability 열** — 화면 스위트가 「이 주체가 보는 것」을 물을 때 쓰는 입력.
 *
 * 프리셋 상수(`server/survey-access` 의 판정)를 다시 읽지 않고 **손으로 옮겨 적는다.** 구현이
 * 스스로를 채점하면 열이 바뀌어도 화면 스위트가 초록으로 남는다 — 판정 자체가 옳은가는
 * `capability-matrix-spec` 과 `*-denial` 이 따로 진다.
 *
 * 여기 사는 이유는 소비자가 셋(탭 스트립·헤더·조사 대상 목록)이고 전부 colocated 라 어느 한
 * 파일도 집이 될 수 없어서다. 확장자가 `.test.ts` 가 아니라 vitest include 에 잡히지 않는다.
 */
import type { SurveyCapability } from '@/shared/contracts/workspace';

/**
 * 외주 실사 링크 — 열람·현황·조사 대상·결과 기록 넷(ADR-0026)에 응답 목록·상세·수정과
 * 조사 대상 단건 메일 둘(ADR-0027). 응답 관리(`responses.manage`)와 메일 탭은 없다.
 */
export const LINK_CAPABILITIES: readonly SurveyCapability[] = [
  'survey.view',
  'operations.view',
  'responses.view',
  'contacts.view',
  'contacts.writeAttempts',
  'mail.sendSingle',
];

/**
 * **전체 권한 참여자** — 사내 실사원이 초대되는 등급 (스펙 §8 참여자 열, ADR-0026 티켓 10).
 *
 * 설문의 처분권(발행·공유 관리·소유권 이전)과 팀 소유 구조(그룹)만 빠지고 운영은 전부 열린다.
 * 그래서 사내 실사원에게는 전용 콘솔이 필요 없다 — 연구원과 같은 화면에서 일한다.
 *
 * 이 배열이 실제 판정과 같은지는 `survey-participants.realdb` 의 「참여자 열」 테스트가
 * 실 DB 로 잰다. 여기 것은 화면 스위트의 **입력**이고, 손으로 옮겨 적는 것이 규약이다.
 */
export const FULL_PARTICIPANT_CAPABILITIES: readonly SurveyCapability[] = [
  'survey.view',
  'survey.edit',
  'survey.delete',
  'survey.invite',
  'operations.view',
  'responses.view',
  'responses.manage',
  'contacts.view',
  'contacts.manage',
  'contacts.writeAttempts',
  'mail.view',
  'mail.send',
  'mail.sendSingle',
  'analytics.view',
  'export.download',
];

/** 팀 공개 설문의 팀원 — 운영·분석은 보되 응답자 개인 데이터에는 닿지 않는다. */
export const TEAM_MEMBER_CAPABILITIES: readonly SurveyCapability[] = [
  'survey.view',
  'survey.edit',
  'survey.invite',
  'operations.view',
  'analytics.view',
  'surveyGroup.manage',
];
