import { describe, expect, it } from 'vitest';

import { copyKeepsOriginalTeam } from './survey';

describe('copyKeepsOriginalTeam — 복제본이 원본 팀을 잇는가', () => {
  const member = { isSuperadmin: false, activeTeamIds: ['team-a'] };

  it('원본 팀의 활성 멤버가 복제하면 원본 팀을 잇는다', () => {
    expect(copyKeepsOriginalTeam(member, 'team-a')).toBe(true);
  });

  it('원본 팀 밖의 참여자가 복제하면 잇지 않는다 — 소유자 분기는 소유 팀 소속을 요구한다', () => {
    // 이으면 복제한 사람이 소유자인데 그 팀 소속이 아니라 capability 가 하나도 안 선다.
    expect(copyKeepsOriginalTeam({ isSuperadmin: false, activeTeamIds: ['team-b'] }, 'team-a')).toBe(
      false,
    );
  });

  it('슈퍼어드민은 소속 없이 전권이라 원본 팀을 잇는다', () => {
    expect(copyKeepsOriginalTeam({ isSuperadmin: true, activeTeamIds: [] }, 'team-a')).toBe(true);
  });

  it('원본이 배치 대기(팀 없음)면 판정할 팀이 없어 그대로 잇는다', () => {
    expect(copyKeepsOriginalTeam(member, null)).toBe(true);
  });
});
