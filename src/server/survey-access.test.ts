import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SURVEY_GUEST_TABS,
  NO_SURVEY_GUEST_TABS,
  surveyCapabilityValues,
  type SurveyCapability,
} from '@/shared/contracts/workspace';

import {
  denialReasonFor,
  participantAccessLevelFor,
  resolveSurveyAccess,
  resolveSurveyCapabilities,
  type SurveyAccessSubject,
  type SurveyAccessTarget,
} from './survey-access';

/**
 * 스펙 §8 capability 매트릭스와 1:1 대조.
 *
 * 표를 그대로 옮겨 열마다 검증한다 — 프리셋 상수를 다시 읽어 비교하면 구현이 스스로를
 * 채점하게 되어 매트릭스가 바뀌어도 GREEN 이 유지된다.
 */

const TEAM_ID = 'team-1';
const OTHER_TEAM_ID = 'team-2';
const OWNER_ID = 'user-owner';

function subject(over: Partial<SurveyAccessSubject> = {}): SurveyAccessSubject {
  return {
    userId: 'user-1',
    isSuperadmin: false,
    userType: 'internal',
    activeTeamIds: [TEAM_ID],
    leaderTeamIds: [],
    // 실사 축 — 내부 주체에는 없다(티켓 25). 실사 열은 아래 전용 팩토리가 채운다.
    fieldworkOrgId: null,
    fieldworkRole: null,
    ...over,
  };
}

function survey(over: Partial<SurveyAccessTarget> = {}): SurveyAccessTarget {
  return {
    teamId: TEAM_ID,
    visibility: 'team',
    ownerUserId: OWNER_ID,
    assignmentStatus: 'assigned',
    ...over,
  };
}

function caps(...args: Parameters<typeof resolveSurveyCapabilities>): SurveyCapability[] {
  return [...resolveSurveyCapabilities(...args)].sort();
}

// 스펙 §8 표의 열 — 각 주체가 갖는 capability 전체.
const OWNER_COLUMN: SurveyCapability[] = [...surveyCapabilityValues];
const LEADER_COLUMN: SurveyCapability[] = [...surveyCapabilityValues];
const PARTICIPANT_COLUMN: SurveyCapability[] = [
  'survey.view',
  'survey.edit',
  'survey.delete',
  'survey.invite',
  'operations.view',
  'responses.view',
  'contacts.view',
  'contacts.manage',
  'contacts.writeAttempts',
  'mail.view',
  'mail.send',
  'analytics.view',
  'export.download',
];
const TEAM_MEMBER_COLUMN: SurveyCapability[] = [
  'survey.view',
  'survey.edit',
  'survey.invite',
  'operations.view',
  'analytics.view',
  'surveyGroup.manage',
];
/**
 * 참여자 팀장 열 — 초대의 **전파**로 서는 파생 시야다.
 *
 * 값이 제한 참여자 열과 같은 것이 상한이다(0123): 본인이 full 이면 팀장은 더 좁고, limited
 * 면 동등해 **어느 경우에도 팀장이 본인보다 넓어지지 않는다**. 여기 **없는 것**이 이 문으로
 * 열리지 않는 것의 정본이다 — responses.view · contacts.* · mail.* · export.download ·
 * survey.delete · surveyGroup.manage.
 */
const PARTICIPANT_LEADER_COLUMN: SurveyCapability[] = [
  'survey.view',
  'survey.edit',
  'survey.invite',
  'operations.view',
  'analytics.view',
];

/**
 * 게스트 열 — 프리뷰와 허용 탭뿐이다(스펙 §8).
 *
 * 여기 **없는 것**이 티켓 21 의 「항상 차단」 목록과 같은 문장이다: analytics.view ·
 * export.download · responses.view · contacts.view · mail.* · survey.edit.
 */
const GUEST_COLUMN: SurveyCapability[] = ['survey.view', 'operations.view'];

describe('resolveSurveyCapabilities — 스펙 §8 매트릭스 열', () => {
  it('슈퍼어드민은 전 capability 를 갖는다', () => {
    expect(caps(subject({ isSuperadmin: true, activeTeamIds: [] }), survey())).toEqual(
      [...surveyCapabilityValues].sort(),
    );
  });

  it('소유자 열 — 소유 팀에 소속돼 있을 때', () => {
    expect(caps(subject({ userId: OWNER_ID, activeTeamIds: [TEAM_ID] }), survey())).toEqual(
      OWNER_COLUMN.sort(),
    );
  });

  it('소유 팀 팀장 열 — 소유자와 같은 전권', () => {
    expect(
      caps(subject({ activeTeamIds: [TEAM_ID], leaderTeamIds: [TEAM_ID] }), survey()),
    ).toEqual(LEADER_COLUMN.sort());
  });

  it('참여자 열 — publish·manageAccess·transferOwnership·surveyGroup.manage 는 없다', () => {
    expect(caps(subject(), survey(), { kind: 'member' })).toEqual(PARTICIPANT_COLUMN.sort());
  });

  it('팀원 열 — 편집·초대·현황·분석·그룹 관리까지, 응답·컨택·메일·export 는 없다', () => {
    expect(caps(subject(), survey())).toEqual(TEAM_MEMBER_COLUMN.sort());
  });
});

describe('resolveSurveyCapabilities — 차단 분기', () => {
  it('배치 대기 설문은 슈퍼어드민 외 전부 차단 — 소유자도 못 본다', () => {
    const pending = survey({ teamId: null, assignmentStatus: 'assignment_pending' });
    expect(caps(subject({ userId: OWNER_ID }), pending)).toEqual([]);
    expect(caps(subject({ leaderTeamIds: [TEAM_ID] }), pending)).toEqual([]);
    expect(caps(subject(), pending, { kind: 'member' })).toEqual([]);
    expect(caps(subject({ isSuperadmin: true }), pending)).toEqual(
      [...surveyCapabilityValues].sort(),
    );
  });

  it('팀 미배치 사용자는 초대 설문을 포함해 전부 차단된다', () => {
    const unassigned = subject({ userId: OWNER_ID, activeTeamIds: [], leaderTeamIds: [] });
    expect(caps(unassigned, survey())).toEqual([]);
    expect(caps(unassigned, survey(), { kind: 'member' })).toEqual([]);
  });

  it('타 팀 팀원은 팀 공개 설문에도 접근할 수 없다', () => {
    expect(caps(subject({ activeTeamIds: [OTHER_TEAM_ID] }), survey())).toEqual([]);
  });

  it('타 팀 팀장의 leader 권한은 자기 팀 설문에만 선다', () => {
    expect(
      caps(subject({ activeTeamIds: [OTHER_TEAM_ID], leaderTeamIds: [OTHER_TEAM_ID] }), survey()),
    ).toEqual([]);
  });

  it('소유자 미지정 설문에서 userId 가 null 과 맞아떨어지는 일은 없다', () => {
    expect(caps(subject(), survey({ ownerUserId: null }), null)).toEqual(
      TEAM_MEMBER_COLUMN.sort(),
    );
  });
});

describe('resolveSurveyCapabilities — 소유권은 팀 제외로 끊긴다', () => {
  // 팀을 접근 경계로 삼는 계약이 제외로 끊기지 않으면 경계가 아니다(Codex 적대적 리뷰).
  // 3번 가드는 "아무 팀에나 속했는가"만 묻기 때문에 겸직이 남으면 그대로 통과했다.
  it('소유 팀에서 빠진 소유자는 겸직이 남아 있어도 전권을 잃는다', () => {
    const removedOwner = subject({ userId: OWNER_ID, activeTeamIds: [OTHER_TEAM_ID] });
    expect(caps(removedOwner, survey())).toEqual([]);
  });

  it('그래도 설문이 고아가 되지는 않는다 — 소유 팀 팀장과 슈퍼어드민은 남는다', () => {
    expect(
      caps(subject({ activeTeamIds: [TEAM_ID], leaderTeamIds: [TEAM_ID] }), survey()),
    ).toEqual(LEADER_COLUMN.sort());
    expect(caps(subject({ isSuperadmin: true, activeTeamIds: [] }), survey())).toEqual(
      [...surveyCapabilityValues].sort(),
    );
  });

  it('소유 팀에 남아 있으면 invite_only 여도 전권이다', () => {
    expect(
      caps(subject({ userId: OWNER_ID, activeTeamIds: [TEAM_ID] }), survey({ visibility: 'invite_only' })),
    ).toEqual(OWNER_COLUMN.sort());
  });
});

describe('resolveSurveyCapabilities — invite_only 는 팀원에게만 숨긴다', () => {
  const inviteOnly = survey({ visibility: 'invite_only' });

  it('팀원은 접근할 수 없다', () => {
    expect(caps(subject(), inviteOnly)).toEqual([]);
  });

  it('소유자·소유 팀 팀장·슈퍼어드민은 팀 공개와 동일하게 동작한다', () => {
    expect(caps(subject({ userId: OWNER_ID }), inviteOnly)).toEqual(OWNER_COLUMN.sort());
    expect(caps(subject({ leaderTeamIds: [TEAM_ID] }), inviteOnly)).toEqual(LEADER_COLUMN.sort());
    expect(caps(subject({ isSuperadmin: true }), inviteOnly)).toEqual(
      [...surveyCapabilityValues].sort(),
    );
  });

  it('참여자는 공개 범위와 무관하게 같은 권한을 갖는다', () => {
    expect(caps(subject(), inviteOnly, { kind: 'member' })).toEqual(
      caps(subject(), survey(), { kind: 'member' }),
    );
  });
});

/** 제한 참여자 열 — 참여자 열과 팀원 열의 교집합 (0123). */
const LIMITED_PARTICIPANT_COLUMN: SurveyCapability[] = PARTICIPANT_COLUMN.filter((c) =>
  TEAM_MEMBER_COLUMN.includes(c),
);

describe('참여자 권한 등급 — 초대가 초대자보다 넓은 권한을 만들지 않는다 (0123)', () => {
  const otherTeam = subject({ activeTeamIds: ['99999999-0000-4000-8000-000000000000'] });

  it('limited 참여자는 열람·편집·초대·현황·분석만 — 응답·컨택·메일·export·삭제가 없다', () => {
    expect(caps(otherTeam, survey(), { kind: 'member', accessLevel: 'limited' })).toEqual(
      LIMITED_PARTICIPANT_COLUMN.sort(),
    );
    expect(LIMITED_PARTICIPANT_COLUMN).not.toContain('responses.view');
    expect(LIMITED_PARTICIPANT_COLUMN).not.toContain('export.download');
    expect(LIMITED_PARTICIPANT_COLUMN).not.toContain('survey.delete');
  });

  it('등급이 없는 참여 행은 full 이다 — 0123 이전 행의 권한을 줄이지 않는다', () => {
    expect(caps(otherTeam, survey(), { kind: 'member' })).toEqual(PARTICIPANT_COLUMN.sort());
  });

  it('팀원이 자기 자신을 limited 로 초대해도 팀원 열보다 넓어지지 않는다 — 그룹 관리도 잃지 않는다', () => {
    expect(caps(subject(), survey(), { kind: 'member', accessLevel: 'limited' })).toEqual(
      TEAM_MEMBER_COLUMN.sort(),
    );
  });

  it('초대 전용 설문의 limited 참여자도 교집합만 갖는다', () => {
    expect(
      caps(subject(), survey({ visibility: 'invite_only' }), {
        kind: 'member',
        accessLevel: 'limited',
      }),
    ).toEqual(LIMITED_PARTICIPANT_COLUMN.sort());
  });
});

describe('participantAccessLevelFor — 등급은 초대자의 권한이 정한다', () => {
  it('참여자 열 전부를 가진 초대자(소유자·팀장·슈퍼어드민·full 참여자)는 full 로 초대한다', () => {
    expect(participantAccessLevelFor(new Set(OWNER_COLUMN))).toBe('full');
    expect(participantAccessLevelFor(new Set(PARTICIPANT_COLUMN))).toBe('full');
  });

  it('팀원·limited 참여자는 limited 로만 초대한다 — 상호 초대로도 넓어지지 않는다', () => {
    expect(participantAccessLevelFor(new Set(TEAM_MEMBER_COLUMN))).toBe('limited');
    expect(participantAccessLevelFor(new Set(LIMITED_PARTICIPANT_COLUMN))).toBe('limited');
  });
});

describe('resolveSurveyCapabilities — 계정 유형', () => {
  it('유형 게이트는 슈퍼어드민 플래그보다 먼저다', () => {
    // isSuperadmin 은 internal 전용 플래그다 — 비내부 계정에 실려 와도 열지 않는다.
    expect(caps(subject({ userType: 'fieldwork', isSuperadmin: true }), survey())).toEqual([]);
  });
});

describe('resolveSurveyCapabilities — 실사 열 (티켓 25)', () => {
  const ORG = 'org-green';
  const fieldwork = (role: 'leader' | 'worker', orgId: string | null = ORG) =>
    subject({
      userType: 'fieldwork',
      activeTeamIds: [],
      leaderTeamIds: [],
      fieldworkOrgId: orgId,
      fieldworkRole: role,
    });

  const INVITED_COLUMN: SurveyCapability[] = [
    'survey.view',
    'operations.view',
    'contacts.view',
    'contacts.writeAttempts',
  ];

  it('초대된 실사원은 조사 대상 원본과 결과코드 쓰기까지 — 편집·메일·export·분석은 없다', () => {
    // 게스트의 마스킹 원칙과 갈리는 지점이다: 대리 실사라는 업무가 연락처를 전제한다(ADR-0019).
    expect(caps(fieldwork('worker'), survey(), { kind: 'fieldwork' })).toEqual(
      INVITED_COLUMN.sort(),
    );
  });

  it('초대가 없으면 아무것도 없다 — 실사원에게는 파생 시야가 없다', () => {
    expect(caps(fieldwork('worker'), survey())).toEqual([]);
    expect(caps(fieldwork('worker'), survey(), null, { fieldworkOrgInvited: true })).toEqual([]);
  });

  it('팀장은 소속원이 초대된 설문을 초대 없이 본다 — 열람 한정', () => {
    const derived = caps(fieldwork('leader'), survey(), null, { fieldworkOrgInvited: true });
    // 「본인 초대 시」만 기록할 수 있다(스펙 §6 표) — 갈리는 칸은 결과코드 하나뿐이다.
    expect(derived).toEqual(INVITED_COLUMN.filter((c) => c !== 'contacts.writeAttempts').sort());
  });

  it('본인이 초대된 팀장은 실사원 열을 그대로 갖는다 — 파생 시야가 권한을 깎지 않는다', () => {
    expect(
      caps(fieldwork('leader'), survey(), { kind: 'fieldwork' }, { fieldworkOrgInvited: true }),
    ).toEqual(INVITED_COLUMN.sort());
  });

  it('업체 밖 설문은 팀장에게도 닫힌다 — 파생 시야의 경계가 업체다', () => {
    expect(caps(fieldwork('leader'), survey(), null, { fieldworkOrgInvited: false })).toEqual([]);
  });

  it('소속 업체가 없으면 초대가 있어도 닫힌다 — 0120 CHECK 에만 기대지 않는다', () => {
    expect(caps(fieldwork('worker', null), survey(), { kind: 'fieldwork' })).toEqual([]);
  });

  it('참여자·게스트 행으로는 실사 자격이 서지 않는다', () => {
    expect(caps(fieldwork('worker'), survey(), { kind: 'member' })).toEqual([]);
    expect(caps(fieldwork('worker'), survey(), { kind: 'guest' })).toEqual([]);
  });

  it('배치 대기 설문은 초대·파생 시야 둘 다 닫는다', () => {
    const pending = survey({ teamId: null, assignmentStatus: 'assignment_pending' });
    expect(caps(fieldwork('worker'), pending, { kind: 'fieldwork' })).toEqual([]);
    expect(caps(fieldwork('leader'), pending, null, { fieldworkOrgInvited: true })).toEqual([]);
  });

  it('공개 범위는 실사 판정에 관여하지 않는다 — 초대가 유일한 자격이다', () => {
    expect(
      caps(fieldwork('worker'), survey({ visibility: 'invite_only' }), { kind: 'fieldwork' }),
    ).toEqual(INVITED_COLUMN.sort());
  });

  it('실사에게는 탭 축이 없다 — guestTabs 는 null 이다', () => {
    const access = resolveSurveyAccess(fieldwork('worker'), survey(), { kind: 'fieldwork' });
    expect(access.guestTabs).toBeNull();
  });
});

describe('resolveSurveyCapabilities — 초대의 팀장 전파', () => {
  /** 소유 팀 밖의 팀장 — 자기 팀원이 초대돼야 비로소 선다. */
  const outsideLeader = subject({
    userId: 'leader-of-other-team',
    activeTeamIds: [OTHER_TEAM_ID],
    leaderTeamIds: [OTHER_TEAM_ID],
  });

  it('내 팀원이 초대된 설문을 팀장이 제한 참여자 열로 본다', () => {
    expect(caps(outsideLeader, survey(), null, { participantTeamLed: true })).toEqual(
      PARTICIPANT_LEADER_COLUMN.sort(),
    );
  });

  it('전파가 없으면 아무것도 열리지 않는다', () => {
    expect(caps(outsideLeader, survey(), null, { participantTeamLed: false })).toEqual([]);
    // relation 자체가 없는 호출(대부분의 배치 경로)도 같다 — 좁은 쪽으로 틀린다.
    expect(caps(outsideLeader, survey())).toEqual([]);
  });

  it('팀장이 본인보다 넓어지지 않는다', () => {
    const full = caps(
      subject({ userId: 'participant', activeTeamIds: [OTHER_TEAM_ID] }),
      survey(),
      { kind: 'member' },
    );
    // full 참여자 ⊃ 전파 팀장 — 응답 원문·삭제·메일·export 가 전파로는 넘어오지 않는다.
    for (const capability of PARTICIPANT_LEADER_COLUMN) {
      expect(full).toContain(capability);
    }
    expect(PARTICIPANT_LEADER_COLUMN.length).toBeLessThan(full.length);
  });

  it('전파는 팀원 열을 깎지 않는다', () => {
    // 소유 팀 팀원이면서 자기 팀원의 초대로 전파까지 받는 사람 — 팀원 열(surveyGroup.manage
    // 포함)을 그대로 가져야 한다. 파생이 권한을 줄이면 폴더 정리가 초대 한 번에 잠긴다.
    const memberAndLeader = subject({ activeTeamIds: [TEAM_ID], leaderTeamIds: [OTHER_TEAM_ID] });
    expect(caps(memberAndLeader, survey(), null, { participantTeamLed: true })).toEqual(
      TEAM_MEMBER_COLUMN.sort(),
    );
  });

  it('공개 범위는 전파에 관여하지 않는다', () => {
    // invite_only 는 소유 팀 **팀원**에게만 숨기는 것이라(스펙 §3), 팀 축 밖에서 오는 전파는
    // 그 변형에 영향받지 않는다 — 참여자 본인이 그렇듯이.
    expect(
      caps(outsideLeader, survey({ visibility: 'invite_only' }), null, {
        participantTeamLed: true,
      }),
    ).toEqual(PARTICIPANT_LEADER_COLUMN.sort());
  });

  it('배치 대기·팀 미배치는 전파보다 먼저 막는다', () => {
    expect(
      caps(outsideLeader, survey({ assignmentStatus: 'assignment_pending' }), null, {
        participantTeamLed: true,
      }),
    ).toEqual([]);
    const unassigned = subject({ activeTeamIds: [], leaderTeamIds: [] });
    expect(caps(unassigned, survey(), null, { participantTeamLed: true })).toEqual([]);
  });

  it('비내부 계정에는 전파 축이 없다', () => {
    // 게스트·실사는 팀 멤버십이 금지라(스펙 §1) 팀장이라는 개념 자체가 없다. relation 이
    // 실려 와도 각자의 부여 모델만 본다.
    expect(
      caps(subject({ userType: 'guest', activeTeamIds: [], leaderTeamIds: [] }), survey(), null, {
        participantTeamLed: true,
      }),
    ).toEqual([]);
  });
});

describe('resolveSurveyCapabilities — 게스트 열 (티켓 21)', () => {
  const guest = (over: Partial<SurveyAccessSubject> = {}) =>
    subject({ userType: 'guest', activeTeamIds: [], leaderTeamIds: [], ...over });

  it('부여된 설문에서 프리뷰와 현황만 — 분석·export·응답·컨택·메일은 없다', () => {
    expect(caps(guest(), survey(), { kind: 'guest' })).toEqual(GUEST_COLUMN.sort());
  });

  it('부여가 없으면 아무것도 없다 — 설문 존재조차 알리지 않는다', () => {
    expect(caps(guest(), survey())).toEqual([]);
  });

  it('참여자·실사 행으로는 게스트 자격이 서지 않는다', () => {
    expect(caps(guest(), survey(), { kind: 'member' })).toEqual([]);
    expect(caps(guest(), survey(), { kind: 'fieldwork' })).toEqual([]);
  });

  it('공개 범위는 게스트 판정에 관여하지 않는다 — 부여가 유일한 자격이다', () => {
    expect(caps(guest(), survey({ visibility: 'invite_only' }), { kind: 'guest' })).toEqual(
      GUEST_COLUMN.sort(),
    );
  });

  it('배치 대기 설문은 부여돼 있어도 열리지 않는다', () => {
    const pending = survey({ teamId: null, assignmentStatus: 'assignment_pending' });
    expect(caps(guest(), pending, { kind: 'guest' })).toEqual([]);
  });

  it('게스트 계정에 실린 슈퍼어드민 플래그는 무시된다', () => {
    expect(caps(guest({ isSuperadmin: true }), survey(), { kind: 'guest' })).toEqual(
      GUEST_COLUMN.sort(),
    );
  });

  it('부여된 kind 가 guest 여도 계정이 내부면 게스트 사슬을 타지 않는다', () => {
    // 유형이 먼저다 — 내부 계정은 팀·소유 사슬로 판정된다(잘못 만든 행이 권한을 깎지 않는다).
    expect(caps(subject(), survey(), { kind: 'guest' })).toEqual(TEAM_MEMBER_COLUMN.sort());
  });
});

describe('resolveSurveyAccess — 탭 축은 capability 와 따로 산다 (티켓 21)', () => {
  const guest = subject({ userType: 'guest', activeTeamIds: [], leaderTeamIds: [] });

  it('내부 계정에게는 탭 축이 없다 — 전부 false 가 아니라 null 이다', () => {
    expect(resolveSurveyAccess(subject(), survey()).guestTabs).toBeNull();
    expect(resolveSurveyAccess(subject({ isSuperadmin: true }), survey()).guestTabs).toBeNull();
  });

  it('부여된 게스트는 저장된 탭을 그대로 본다', () => {
    const tabs = { overview: false, progressReport: true, contactsMasked: false, quota: true };
    expect(resolveSurveyAccess(guest, survey(), { kind: 'guest', guestTabs: tabs }).guestTabs).toEqual(
      tabs,
    );
  });

  it('탭이 비어 있는 옛 행은 기본값(응답 현황만)으로 읽힌다', () => {
    expect(
      resolveSurveyAccess(guest, survey(), { kind: 'guest', guestTabs: null }).guestTabs,
    ).toEqual(DEFAULT_SURVEY_GUEST_TABS);
  });

  it('부여가 없으면 탭도 전부 닫힌다 — 탭만 열린 상태는 만들지 않는다', () => {
    const access = resolveSurveyAccess(guest, survey());
    expect(access.capabilities.size).toBe(0);
    expect(access.guestTabs).toEqual(NO_SURVEY_GUEST_TABS);
  });

  it('배치 대기 설문은 부여와 탭이 남아 있어도 전부 닫힌다', () => {
    const pending = survey({ teamId: null, assignmentStatus: 'assignment_pending' });
    const tabs = { overview: true, progressReport: true, contactsMasked: true, quota: true };
    expect(resolveSurveyAccess(guest, pending, { kind: 'guest', guestTabs: tabs }).guestTabs).toEqual(
      NO_SURVEY_GUEST_TABS,
    );
  });
});

describe('denialReasonFor — 거부 사유의 유일한 정본', () => {
  it('survey.view 가 없으면 어떤 요구든 not_found — 존재를 알리지 않는다', () => {
    expect(denialReasonFor(new Set(), 'survey.edit')).toBe('not_found');
    expect(denialReasonFor(new Set(), 'survey.view')).toBe('not_found');
  });

  it('보이는 설문에서 그 작업만 못 하면 forbidden', () => {
    expect(
      denialReasonFor(new Set<SurveyCapability>(['survey.view']), 'survey.publish'),
    ).toBe('forbidden');
  });

  it('요구 capability 를 가지면 거부하지 않는다', () => {
    expect(
      denialReasonFor(new Set<SurveyCapability>(['survey.view', 'survey.edit']), 'survey.edit'),
    ).toBeNull();
  });
});
