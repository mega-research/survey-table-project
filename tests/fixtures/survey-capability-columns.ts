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

/** 외주 실사 링크 — 열람·현황·조사 대상·결과 기록 넷 (ADR-0026). */
export const LINK_CAPABILITIES: readonly SurveyCapability[] = [
  'survey.view',
  'operations.view',
  'contacts.view',
  'contacts.writeAttempts',
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
