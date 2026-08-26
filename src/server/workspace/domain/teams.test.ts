/**
 * 팀 멤버십 순수 규칙 (역할 모델 v2 티켓 06).
 *
 * DB 왕복 없이 판정만 떼어 본다 — 서비스는 행을 읽어 이 함수들에게 물을 뿐이라, 규칙이
 * 갈리는 자리는 전부 여기다. 트랜잭션·잠금이 걸린 실제 왕복은
 * tests/integration/teams-membership.realdb.test.ts 가 본다.
 */
import { describe, expect, it } from 'vitest';

import {
  AlreadyTeamMemberError,
  CrossTeamAssignmentError,
  LastTeamLeaderError,
  UnassignableUserError,
  assertLastLeaderKept,
  assertMemberAssignable,
} from './teams';

const TEAM = 'team-1';

function target(overrides: Partial<Parameters<typeof assertMemberAssignable>[0]['target']> = {}) {
  return {
    status: 'active' as const,
    userType: 'internal' as const,
    isSuperadmin: false,
    ...overrides,
  };
}

describe('assertMemberAssignable', () => {
  it('미배치 internal active 사용자는 팀장도 당겨올 수 있다', () => {
    expect(() =>
      assertMemberAssignable({
        actor: { isSuperadmin: false },
        target: target(),
        teamId: TEAM,
        activeTeamIds: [],
      }),
    ).not.toThrow();
  });

  it('게스트·실사 계정은 팀 멤버십 자체가 금지다', () => {
    for (const userType of ['guest', 'fieldwork'] as const) {
      expect(() =>
        assertMemberAssignable({
          actor: { isSuperadmin: true },
          target: target({ userType }),
          teamId: TEAM,
          activeTeamIds: [],
        }),
      ).toThrow(UnassignableUserError);
    }
  });

  it('재직 중이 아닌 계정은 추가하지 않는다', () => {
    expect(() =>
      assertMemberAssignable({
        actor: { isSuperadmin: true },
        target: target({ status: 'suspended' }),
        teamId: TEAM,
        activeTeamIds: [],
      }),
    ).toThrow(UnassignableUserError);
  });

  it('슈퍼어드민은 팀 소속과 무관하므로 팀원이 되지 않는다', () => {
    expect(() =>
      assertMemberAssignable({
        actor: { isSuperadmin: true },
        target: target({ isSuperadmin: true }),
        teamId: TEAM,
        activeTeamIds: [],
      }),
    ).toThrow(UnassignableUserError);
  });

  it('이미 이 팀 소속이면 중복 추가하지 않는다', () => {
    expect(() =>
      assertMemberAssignable({
        actor: { isSuperadmin: true },
        target: target(),
        teamId: TEAM,
        activeTeamIds: [TEAM],
      }),
    ).toThrow(AlreadyTeamMemberError);
  });

  it('타 팀 active 멤버를 당겨오는 것은 팀장에게 막힌다 (pull 은 미배치만)', () => {
    expect(() =>
      assertMemberAssignable({
        actor: { isSuperadmin: false },
        target: target(),
        teamId: TEAM,
        activeTeamIds: ['team-2'],
      }),
    ).toThrow(CrossTeamAssignmentError);
  });

  it('겸직은 슈퍼어드민만 만들 수 있다', () => {
    expect(() =>
      assertMemberAssignable({
        actor: { isSuperadmin: true },
        target: target(),
        teamId: TEAM,
        activeTeamIds: ['team-2'],
      }),
    ).not.toThrow();
  });
});

describe('assertLastLeaderKept', () => {
  it('팀장이 둘 이상이면 한 명을 내려도 된다', () => {
    expect(() => assertLastLeaderKept({ currentRole: 'leader', leaderCount: 2 })).not.toThrow();
  });

  it('마지막 팀장은 강등·제외할 수 없다', () => {
    expect(() => assertLastLeaderKept({ currentRole: 'leader', leaderCount: 1 })).toThrow(
      LastTeamLeaderError,
    );
  });

  it('팀원을 다루는 일은 팀장 수와 무관하다', () => {
    expect(() => assertLastLeaderKept({ currentRole: 'member', leaderCount: 1 })).not.toThrow();
  });
});
