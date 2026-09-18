import { describe, expect, it } from 'vitest';

import type { WorkScope } from '@/shared/contracts/workspace';

import {
  type SurveyCardCapabilitySubject,
  type SurveyCardViewer,
  canDeleteSurveyCard,
  canEditSurveyCard,
  canManageSurveyAccessCard,
  canManageSurveyGroupCard,
  canViewSurveyAnalyticsCard,
} from './survey-list-capability';

const teamSurvey: SurveyCardCapabilitySubject = {
  ownerUserId: 'owner-1',
  visibility: 'team',
  teamId: 'team-1',
  isParticipant: false,
  isFullParticipant: false,
  isLedParticipant: false,
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

  it('소유자를 모르는 옛 설문(0116 이전)은 팀 공개 판정으로만 연다', () => {
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

/**
 * 참여자(티켓 18)가 세 근사를 처음으로 **갈라놓는다**. 티켓 16 당시 두 근사는 결과가 같고
 * 이유만 달랐는데, 목록이 참여 행을 싣게 되면서 그 차이가 실제로 드러난다.
 */
describe('참여자 — 팀 축 밖의 접근', () => {
  const invited: SurveyCardCapabilitySubject = {
    ownerUserId: 'owner-1',
    visibility: 'invite_only',
    // 남의 팀 설문이다 — 지금 보고 있는 범위(team-1)와 소유 팀이 다르다.
    teamId: 'team-9',
    isParticipant: true,
    isFullParticipant: true,
    isLedParticipant: false,
  };

  it('타 팀 초대 설문을 편집·분석할 수 있다 — 팀도 공개 범위도 묻지 않는다', () => {
    const v = viewer();
    expect(canEditSurveyCard(invited, v)).toBe(true);
    expect(canViewSurveyAnalyticsCard(invited, v)).toBe(true);
  });

  it('공개 범위는 못 바꾼다 — 여기서 분석 근사와 갈린다', () => {
    const v = viewer();
    expect(canViewSurveyAnalyticsCard(invited, v)).toBe(true);
    expect(canManageSurveyAccessCard(invited, v)).toBe(false);
  });

  it('제한 참여자는 편집은 되고 분석은 안 된다 — responses.view 가 없다 (0123)', () => {
    const limited = { ...invited, isFullParticipant: false };
    const v = viewer();
    expect(canEditSurveyCard(limited, v)).toBe(true);
    expect(canViewSurveyAnalyticsCard(limited, v)).toBe(false);
  });

  it('초대가 없으면 같은 행이 전부 닫힌다 — 열어준 것은 참여 행 하나다', () => {
    const notInvited = { ...invited, isParticipant: false, isFullParticipant: false };
    const v = viewer();
    expect(canEditSurveyCard(notInvited, v)).toBe(false);
    expect(canViewSurveyAnalyticsCard(notInvited, v)).toBe(false);
    expect(canManageSurveyAccessCard(notInvited, v)).toBe(false);
  });
});

/**
 * 수정·삭제·그룹 이동은 **서로 다른 열**이다. 근사 하나로 셋을 판정하면 눌렀을 때 서버가
 * 거부하는 버튼이 열린 채로 보인다 — 그 어긋남을 여기서 못 박는다.
 */
describe('수정 · 삭제 · 그룹 이동은 갈린다', () => {
  it('팀 공개 설문의 팀원 — 수정·그룹 이동은 되고 삭제는 안 된다', () => {
    const v = viewer();
    expect(canEditSurveyCard(teamSurvey, v)).toBe(true);
    // 그룹은 팀 공용 구조라 팀원도 정리한다(TEAM_MEMBER_CAPS 의 surveyGroup.manage).
    expect(canManageSurveyGroupCard(teamSurvey, v)).toBe(true);
    // survey.delete 는 팀원 열에 없다 — 열어 두면 눌렀을 때 서버가 거부한다.
    expect(canDeleteSurveyCard(teamSurvey, v)).toBe(false);
  });

  it('full 참여자 — 삭제까지 되지만 그룹 이동은 안 된다', () => {
    const invited: SurveyCardCapabilitySubject = {
      ownerUserId: 'owner-1',
      visibility: 'invite_only',
      teamId: 'team-9',
      isParticipant: true,
      isFullParticipant: true,
      isLedParticipant: false,
    };
    const v = viewer();
    expect(canDeleteSurveyCard(invited, v)).toBe(true);
    // 그룹은 팀 소유 구조라 참여자에게는 surveyGroup.manage 가 없다.
    expect(canManageSurveyGroupCard(invited, v)).toBe(false);
  });

  it('제한 참여자 — 삭제가 닫힌다 (survey.delete 없음)', () => {
    const limited: SurveyCardCapabilitySubject = {
      ownerUserId: 'owner-1',
      visibility: 'invite_only',
      teamId: 'team-9',
      isParticipant: true,
      isFullParticipant: false,
      isLedParticipant: false,
    };
    expect(canEditSurveyCard(limited, viewer())).toBe(true);
    expect(canDeleteSurveyCard(limited, viewer())).toBe(false);
  });
});

/**
 * 초대의 **팀장 전파** — 내 팀원이 초대된 설문. 참여 행이 내 이름으로 서지 않으므로
 * `isParticipant` 로는 보이지 않는다. 목록이 이 사실을 싣지 않으면 서버가 `survey.edit` 을
 * 주는데 카드의 「수정」만 잠긴다.
 */
describe('전파 팀장 — 참여 행 없이 편집만 열린다', () => {
  const ledSurvey: SurveyCardCapabilitySubject = {
    ownerUserId: 'owner-1',
    visibility: 'invite_only',
    // 내 팀원이 초대된 타 팀 설문 — 내 범위(team-1)와 소유 팀이 다르다.
    teamId: 'team-9',
    isParticipant: false,
    isFullParticipant: false,
    isLedParticipant: true,
  };

  it('수정은 열린다 — 서버 열(LIMITED_PARTICIPANT_CAPS)에 survey.edit 이 있다', () => {
    expect(canEditSurveyCard(ledSurvey, viewer())).toBe(true);
  });

  it('삭제·분석·공개 범위·그룹 이동은 닫힌다 — 파생이 본인보다 넓어지지 않는다', () => {
    const v = viewer();
    expect(canDeleteSurveyCard(ledSurvey, v)).toBe(false);
    expect(canViewSurveyAnalyticsCard(ledSurvey, v)).toBe(false);
    expect(canManageSurveyAccessCard(ledSurvey, v)).toBe(false);
    expect(canManageSurveyGroupCard(ledSurvey, v)).toBe(false);
  });

  it('전파가 없으면 같은 행이 전부 닫힌다', () => {
    const plain = { ...ledSurvey, isLedParticipant: false };
    expect(canEditSurveyCard(plain, viewer())).toBe(false);
  });
});
