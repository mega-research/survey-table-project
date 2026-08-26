import { describe, expect, it } from 'vitest';

import type { SurveyAccessSubject } from './survey-access';
import { WorkScopeError, buildSurveyScopeFilter, resolveWorkScopeFor } from './work-scope';

const TEAM_UUID = '22222222-2222-4222-8222-222222222222';

function subject(over: Partial<SurveyAccessSubject> = {}): SurveyAccessSubject {
  return {
    userId: 'u-1',
    isSuperadmin: false,
    userType: 'internal',
    activeTeamIds: ['team-1', 'team-2'],
    leaderTeamIds: [],
    ...over,
  };
}

describe('resolveWorkScopeFor — 팀 범위', () => {
  it('요청한 팀이 내 활성 팀이면 그대로 선다', () => {
    expect(resolveWorkScopeFor(subject(), 'team-2')).toEqual({ kind: 'team', teamId: 'team-2' });
  });

  it('요청이 없으면 첫 활성 팀으로 접는다', () => {
    expect(resolveWorkScopeFor(subject(), null)).toEqual({ kind: 'team', teamId: 'team-1' });
  });

  it('내 팀이 아닌 teamId 요청은 거부가 아니라 첫 활성 팀으로 접는다', () => {
    // 쿠키에 남은 옛 팀(해산·이동)으로 화면이 잠기지 않게 한다 — 조회는 해석된 범위로만
    // 나가므로 데이터가 새지 않는다.
    expect(resolveWorkScopeFor(subject(), 'team-9')).toEqual({ kind: 'team', teamId: 'team-1' });
  });

  it('팀 미배치 사용자는 아무 범위도 갖지 못한다', () => {
    const unassigned = subject({ activeTeamIds: [] });
    expect(resolveWorkScopeFor(unassigned, null)).toEqual({ kind: 'none' });
    expect(resolveWorkScopeFor(unassigned, 'team-1')).toEqual({ kind: 'none' });
  });
});

describe('resolveWorkScopeFor — 시스템 전체 보기', () => {
  const su = subject({ isSuperadmin: true, activeTeamIds: [], leaderTeamIds: [] });

  it('슈퍼어드민의 system 요청은 통과하고, 요청이 없으면 system 이 기본이다', () => {
    expect(resolveWorkScopeFor(su, 'system')).toEqual({ kind: 'system' });
    expect(resolveWorkScopeFor(su, null)).toEqual({ kind: 'system' });
  });

  it('슈퍼어드민은 자기 소속이 아닌 팀도 지목할 수 있다', () => {
    expect(resolveWorkScopeFor(su, TEAM_UUID)).toEqual({ kind: 'team', teamId: TEAM_UUID });
  });

  it('슈퍼어드민의 팀 지목도 형식은 본다 — 쿠키의 아무 문자열이 SQL 로 내려가지 않는다', () => {
    // 멤버십으로 걸러지지 않는 경로라 여기서 접지 않으면 uuid 비교에서 Postgres 가 500 을 낸다.
    expect(resolveWorkScopeFor(su, 'not-a-uuid')).toEqual({ kind: 'system' });
  });

  it('일반 사용자의 system 요청은 거부한다 — 조용히 접지 않는다', () => {
    expect(() => resolveWorkScopeFor(subject(), 'system')).toThrow(WorkScopeError);
  });
});

describe('resolveWorkScopeFor — 계정 유형', () => {
  it('게스트·실사는 내부 작업 범위를 갖지 않는다', () => {
    expect(resolveWorkScopeFor(subject({ userType: 'guest' }), null)).toEqual({ kind: 'none' });
    expect(resolveWorkScopeFor(subject({ userType: 'fieldwork' }), 'team-1')).toEqual({
      kind: 'none',
    });
  });
});

describe('buildSurveyScopeFilter — 목록 조회 조건', () => {
  it('시스템 범위는 전 팀 + 배치 대기까지 본다', () => {
    const su = subject({ isSuperadmin: true });
    expect(buildSurveyScopeFilter(su, { kind: 'system' })).toEqual({ kind: 'all' });
  });

  it('팀 범위의 팀원은 invite_only 를 뚫지 못한다', () => {
    expect(buildSurveyScopeFilter(subject(), { kind: 'team', teamId: 'team-1' })).toEqual({
      kind: 'team',
      teamId: 'team-1',
      viewerId: 'u-1',
      seesInviteOnly: false,
    });
  });

  it('그 팀의 팀장은 invite_only 까지 본다', () => {
    const leader = subject({ leaderTeamIds: ['team-1'] });
    expect(buildSurveyScopeFilter(leader, { kind: 'team', teamId: 'team-1' })).toMatchObject({
      seesInviteOnly: true,
    });
  });

  it('다른 팀 팀장이라는 사실은 이 팀에서 아무 힘이 없다', () => {
    const leader = subject({ leaderTeamIds: ['team-2'] });
    expect(buildSurveyScopeFilter(leader, { kind: 'team', teamId: 'team-1' })).toMatchObject({
      seesInviteOnly: false,
    });
  });

  it('슈퍼어드민이 특정 팀을 지목하면 그 팀 안에서 전부 본다', () => {
    const su = subject({ isSuperadmin: true, activeTeamIds: [], leaderTeamIds: [] });
    expect(buildSurveyScopeFilter(su, { kind: 'team', teamId: 'team-9' })).toMatchObject({
      teamId: 'team-9',
      seesInviteOnly: true,
    });
  });

  it('범위가 없으면 아무것도 조회하지 않는다', () => {
    expect(buildSurveyScopeFilter(subject({ activeTeamIds: [] }), { kind: 'none' })).toEqual({
      kind: 'none',
    });
  });
});
