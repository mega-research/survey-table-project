import { describe, expect, it } from 'vitest';

import { canEditSurveyCard, canViewSurveyAnalyticsCard } from './survey-list-capability';

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

/**
 * 분석 화면은 responses.view 까지 요구하므로(Codex 적대적 리뷰) 「분석」 버튼은 수정 버튼보다
 * 좁게 열려야 한다. 특히 **팀 공개 설문의 팀원은 수정은 되는데 분석은 안 된다** — 두 근사가
 * 같아지는 순간 팀원이 누를 때마다 404 로 떨어진다.
 */
describe('canViewSurveyAnalyticsCard', () => {
  const teamScope = { kind: 'team' as const, teamId: 'team-1' };

  it('슈퍼어드민은 항상 true', () => {
    expect(canViewSurveyAnalyticsCard(teamSurvey, { kind: 'system' }, 'u-1', true, [])).toBe(true);
  });

  it('소유 팀에 있는 소유자는 true', () => {
    expect(canViewSurveyAnalyticsCard(teamSurvey, teamScope, 'owner-1', false, [])).toBe(true);
  });

  it('소유 팀 팀장은 true', () => {
    expect(canViewSurveyAnalyticsCard(teamSurvey, teamScope, 'u-2', false, ['team-1'])).toBe(true);
  });

  it('팀 공개 설문의 일반 팀원은 false — 수정은 되지만 분석은 안 된다', () => {
    expect(canEditSurveyCard(teamSurvey, teamScope, 'u-2', false)).toBe(true);
    expect(canViewSurveyAnalyticsCard(teamSurvey, teamScope, 'u-2', false, [])).toBe(false);
  });

  it('타 팀 팀장은 false — 팀장 자격은 그 팀 설문에만 선다', () => {
    expect(canViewSurveyAnalyticsCard(teamSurvey, teamScope, 'u-2', false, ['team-2'])).toBe(false);
  });
});
