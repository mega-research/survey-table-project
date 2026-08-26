import { describe, expect, it } from 'vitest';

import { canEditSurveyCard } from './survey-list-capability';

const teamSurvey = {
  ownerUserId: 'owner-1',
  visibility: 'team' as const,
  teamId: 'team-1',
};

describe('canEditSurveyCard', () => {
  it('슈퍼어드민은 항상 true', () => {
    expect(canEditSurveyCard(teamSurvey, { kind: 'system' }, 'su-1', true)).toBe(true);
  });

  it('본인 소유 설문은 범위와 무관하게 true', () => {
    expect(canEditSurveyCard(teamSurvey, { kind: 'system' }, 'owner-1', false)).toBe(true);
  });

  it('지금 보고 있는 팀의 팀 공개 설문은 true', () => {
    expect(
      canEditSurveyCard(teamSurvey, { kind: 'team', teamId: 'team-1' }, 'member-9', false),
    ).toBe(true);
  });

  it('초대 전용 설문은 비소유자에게 false — 팀원에게만 숨김이 어휘의 뜻', () => {
    expect(
      canEditSurveyCard(
        { ...teamSurvey, visibility: 'invite_only' },
        { kind: 'team', teamId: 'team-1' },
        'member-9',
        false,
      ),
    ).toBe(false);
  });

  it('소유자를 모르는 옛 설문(0089 이전)은 팀 공개 판정으로만 연다', () => {
    expect(
      canEditSurveyCard(
        { ...teamSurvey, ownerUserId: null },
        { kind: 'team', teamId: 'team-2' },
        'member-9',
        false,
      ),
    ).toBe(false);
  });
});
