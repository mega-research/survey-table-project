'use client';

import { createContext, useContext } from 'react';

import type { WorkScope } from '@/shared/contracts/workspace';

/**
 * 작업 범위 컨텍스트 — admin 셸이 값을 채우고 하위 화면이 읽는다 (역할 모델 v2 티켓 08).
 *
 * 공급자는 features/workspace 의 AdminShell, 소비자는 설문 목록(features/survey-builder)처럼
 * 다른 feature 다. feature 간 직접 import 는 금지라 모양이 여기(shared) 산다 — 값의 출처는
 * 레이아웃이 서버에서 해석한 범위(server/work-scope)이고, 이 컨텍스트는 그것을 화면 트리에
 * 나르는 통로일 뿐이다.
 */
export interface WorkScopeContextValue {
  /** 현재 작업 범위 — 서버가 해석한 값에서 출발한다. 화면이 고른 값이 아니다. */
  scope: WorkScope;
  /** 스위처가 고를 수 있는 팀 — 내 활성 소속. 슈퍼어드민은 전 팀. */
  teams: { id: string; name: string }[];
  /** 「메가리서치」(시스템 전체 보기)를 고를 수 있는가 — 슈퍼어드민만. */
  canSeeSystemScope: boolean;
  isSuperadmin: boolean;
  /** 세션 사용자 id — 카드 버튼 노출 근사(canEditSurveyCard)용. 판정은 서버가 한다. */
  currentUserId: string | null;
  /**
   * 내가 팀장인 팀 — 카드 버튼 노출 근사용. 판정은 서버가 한다.
   *
   * 팀장과 팀원은 같은 팀 범위 안에서도 갖는 capability 가 다르다(팀장은 전권, 팀원은
   * 응답·컨택·메일·export 가 없다). role 없이 근사하면 팀장의 버튼까지 함께 감춰진다.
   */
  leaderTeamIds: readonly string[];
  /**
   * 범위 전환 — teamId 또는 SYSTEM_SCOPE('system')를 받는다.
   * 쿠키 기록·설문 캐시 무효화·RSC 갱신은 공급자(AdminShell)가 처리한다.
   */
  setScope: (next: string) => void;
}

export const WorkScopeContext = createContext<WorkScopeContextValue | null>(null);

/** AdminShell 하위 어디서든 현재 작업 범위와 전환 함수를 읽는다. */
export function useWorkScope(): WorkScopeContextValue {
  const ctx = useContext(WorkScopeContext);
  if (!ctx) {
    throw new Error('useWorkScope 는 AdminShell 하위 컴포넌트에서만 사용할 수 있습니다.');
  }
  return ctx;
}

/**
 * 셸 밖(테스트 렌더·프록시 미경유 경로 등 Provider 가 없는 트리)에서도 안전한 버전 —
 * provider 가 없으면 null. 호출측이 "셸 안이면 범위, 아니면 폴백" 을 스스로 판단할 때 쓴다.
 */
export function useWorkScopeOptional(): WorkScopeContextValue | null {
  return useContext(WorkScopeContext);
}
