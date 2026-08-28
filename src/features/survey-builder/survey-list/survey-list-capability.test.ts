import { describe, expect, it } from 'vitest';

import type { WorkScope } from '@/shared/contracts/workspace';

import {
  type SurveyCardCapabilitySubject,
  type SurveyCardViewer,
  canEditSurveyCard,
  canManageSurveyAccessCard,
  canViewSurveyAnalyticsCard,
} from './survey-list-capability';

const teamSurvey: SurveyCardCapabilitySubject = {
  ownerUserId: 'owner-1',
  visibility: 'team',
  teamId: 'team-1',
};

const teamScope: WorkScope = { kind: 'team', teamId: 'team-1' };
const systemScope: WorkScope = { kind: 'system' };

function viewer(overrides: Partial<SurveyCardViewer> = {}): SurveyCardViewer {
  return {
    scope: teamScope,
    currentUserId: 'member-9',
    isSuperadmin: false,
    leaderTeamIds: [],
    ...overrides,
  };
}

describe('canEditSurveyCard', () => {
  it('슈퍼어드민은 항상 true', () => {
    expect(
      canEditSurveyCard(
        teamSurvey,
        viewer({ scope: systemScope, currentUserId: 'su-1', isSuperadmin: true }),
      ),
    ).toBe(true);
  });

  it('본인 소유 설문은 범위와 무관하게 true', () => {
    expect(
      canEditSurveyCard(teamSurvey, viewer({ scope: systemScope, currentUserId: 'owner-1' })),
    ).toBe(true);
  });

  it('지금 보고 있는 팀의 팀 공개 설문은 true', () => {
    expect(canEditSurveyCard(teamSurvey, viewer())).toBe(true);
  });

  it('초대 전용 설문은 비소유자에게 false — 팀원에게만 숨김이 어휘의 뜻', () => {
    expect(canEditSurveyCard({ ...teamSurvey, visibility: 'invite_only' }, viewer())).toBe(false);
  });

  it('소유자를 모르는 옛 설문(0089 이전)은 팀 공개 판정으로만 연다', () => {
    expect(
      canEditSurveyCard(
        { ...teamSurvey, ownerUserId: null },
        viewer({ scope: { kind: 'team', teamId: 'team-2' } }),
      ),
    ).toBe(false);
  });
});

/**
 * 「분석」과 「공유 설정의 범위 세그먼트」는 **오늘 결과가 같다**(둘 다 전권 세 열). 이유는
 * 다르다 — 분석은 responses.view 를, 공유는 survey.manageAccess 를 근사하고 참여자
 * (티켓 18)는 앞의 것만 갖는다. 그래서 케이스는 한 번만 적고 두 함수에 함께 물어, 오늘의
 * 동치를 명시적으로 못 박는다. 갈리는 날 이 표가 그 자리에서 빨개진다.
 */
describe('전권 세 열 근사 — 분석 · 공유 범위', () => {
  const cases: ReadonlyArray<[string, SurveyCardViewer, SurveyCardCapabilitySubject, boolean]> = [
    [
      '슈퍼어드민은 항상 true',
      viewer({ scope: systemScope, isSuperadmin: true }),
      teamSurvey,
      true,
    ],
    ['소유 팀에 있는 소유자는 true', viewer({ currentUserId: 'owner-1' }), teamSurvey, true],
    ['소유 팀 팀장은 true', viewer({ leaderTeamIds: ['team-1'] }), teamSurvey, true],
    [
      '소유 팀 팀장은 invite_only 여도 true',
      viewer({ leaderTeamIds: ['team-1'] }),
      { ...teamSurvey, visibility: 'invite_only' },
      true,
    ],
    ['일반 팀원은 false', viewer(), teamSurvey, false],
    [
      '타 팀 팀장은 false — 팀장 자격은 그 팀 설문에만 선다',
      viewer({ leaderTeamIds: ['team-2'] }),
      teamSurvey,
      false,
    ],
    [
      '소유 팀에서 빠진 소유자는 false — 서버의 revocation 계약과 같은 방향',
      viewer({ scope: { kind: 'team', teamId: 'team-2' }, currentUserId: 'owner-1' }),
      teamSurvey,
      false,
    ],
  ];

  it.each(cases)('%s', (_name, v, survey, expected) => {
    expect(canViewSurveyAnalyticsCard(survey, v)).toBe(expected);
    expect(canManageSurveyAccessCard(survey, v)).toBe(expected);
  });

  /**
   * 두 근사는 `canEditSurveyCard` 보다 **좁아야** 한다. 같아지는 순간 팀원이 「분석」을
   * 누르면 404 로 떨어지고(responses.view 없음), 공개 범위를 초대 전용으로 바꿔 자기가
   * 못 고치는 설문을 팀에서 숨길 수 있다.
   */
  it('팀 공개 설문의 일반 팀원은 편집은 되지만 분석·공개 범위는 안 된다', () => {
    const v = viewer();
    expect(canEditSurveyCard(teamSurvey, v)).toBe(true);
    expect(canViewSurveyAnalyticsCard(teamSurvey, v)).toBe(false);
    expect(canManageSurveyAccessCard(teamSurvey, v)).toBe(false);
  });
});
