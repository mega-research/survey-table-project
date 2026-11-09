import { describe, expect, it } from 'vitest';

import { defaultSurveyListWhose } from './survey-builder-io';

// 설문 목록 보는 자리의 역할 기본값 (0158) — 고른 적이 없을 때만 쓴다.

describe('defaultSurveyListWhose', () => {
  it('팀 범위의 팀원은 내 설문이 기본이다', () => {
    expect(
      defaultSurveyListWhose({
        isSuperadmin: false,
        isLeaderOfScopeTeam: false,
        scopeKind: 'team',
      }),
    ).toBe('mine');
  });

  it('그 팀의 팀장과 슈퍼어드민은 팀 전체가 기본이다', () => {
    expect(
      defaultSurveyListWhose({ isSuperadmin: false, isLeaderOfScopeTeam: true, scopeKind: 'team' }),
    ).toBe('team');
    expect(
      defaultSurveyListWhose({ isSuperadmin: true, isLeaderOfScopeTeam: false, scopeKind: 'team' }),
    ).toBe('team');
  });

  it('시스템 전체 보기·미배치는 늘 팀 전체다 — 「내 설문」이라는 자리가 없다', () => {
    expect(
      defaultSurveyListWhose({
        isSuperadmin: true,
        isLeaderOfScopeTeam: false,
        scopeKind: 'system',
      }),
    ).toBe('team');
    expect(
      defaultSurveyListWhose({
        isSuperadmin: false,
        isLeaderOfScopeTeam: false,
        scopeKind: 'none',
      }),
    ).toBe('team');
  });
});
