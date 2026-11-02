/**
 * 목록 상태 판정 표 — TS 함수(`resolveSurveyListLifecycle`)와 SQL 식(`surveyListLifecycleSql`)이
 * **같은 표**로 검사된다. 한쪽만 고치면 둘 중 한 스위트가 깨진다.
 *
 * 기대값은 스펙(PRD 「목록 상태 판정」)에서 온다 — 작성중 = 배포 전(마감일 무관), 진행중 =
 * 배포됨 + 마감일 없음/미경과(일시 중단 포함), 종료 = 종료 스위치 또는 배포됨 + 마감일 경과.
 */
import type { SurveyListLifecycle } from '@/shared/contracts/survey-builder-io';

export const LIFECYCLE_NOW = new Date('2026-11-02T03:00:00.000Z');

const PAST = new Date(LIFECYCLE_NOW.getTime() - 60_000);
const FUTURE = new Date(LIFECYCLE_NOW.getTime() + 60_000);

export interface SurveyListLifecycleCase {
  name: string;
  /** DB text 그대로 — 모르는 값의 접힘도 표에 넣는다. */
  status: string;
  currentVersionId: string | null;
  isPaused: boolean;
  endDate: Date | null;
  expected: SurveyListLifecycle;
}

const VERSION = '00000000-0000-4000-8000-000000000001';

export const SURVEY_LIST_LIFECYCLE_CASES: readonly SurveyListLifecycleCase[] = [
  { name: '초안', status: 'draft', currentVersionId: null, isPaused: false, endDate: null, expected: 'draft' },
  { name: '초안 + 마감일 경과 — 마감일 무관', status: 'draft', currentVersionId: null, isPaused: false, endDate: PAST, expected: 'draft' },
  { name: '배포 + 마감일 없음', status: 'published', currentVersionId: VERSION, isPaused: false, endDate: null, expected: 'running' },
  { name: '배포 + 마감일 미래', status: 'published', currentVersionId: VERSION, isPaused: false, endDate: FUTURE, expected: 'running' },
  { name: '배포 + 마감일 경과', status: 'published', currentVersionId: VERSION, isPaused: false, endDate: PAST, expected: 'closed' },
  { name: '배포 + 중단 — 진행중', status: 'published', currentVersionId: VERSION, isPaused: true, endDate: null, expected: 'running' },
  { name: '배포 + 중단 + 마감일 경과 — 종료', status: 'published', currentVersionId: VERSION, isPaused: true, endDate: PAST, expected: 'closed' },
  { name: '종료 스위치', status: 'closed', currentVersionId: VERSION, isPaused: false, endDate: null, expected: 'closed' },
  { name: '종료 스위치 + 마감일 미래', status: 'closed', currentVersionId: VERSION, isPaused: false, endDate: FUTURE, expected: 'closed' },
  { name: '배포 버전이 없으면 배포 전 — 상태가 무엇이든', status: 'closed', currentVersionId: null, isPaused: false, endDate: PAST, expected: 'draft' },
  { name: '모르는 상태 값은 초안으로 접힌다', status: 'archived', currentVersionId: VERSION, isPaused: false, endDate: PAST, expected: 'draft' },
];
