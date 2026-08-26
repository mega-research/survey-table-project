import { describe, expect, it } from 'vitest';

import { surveyCapabilityValues, type SurveyCapability } from '@/shared/contracts/workspace';

import {
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

describe('resolveSurveyCapabilities — 스펙 §8 매트릭스 열', () => {
  it('슈퍼어드민은 전 capability 를 갖는다', () => {
    expect(caps(subject({ isSuperadmin: true, activeTeamIds: [] }), survey())).toEqual(
      [...surveyCapabilityValues].sort(),
    );
  });

  it('소유자 열', () => {
    expect(caps(subject({ userId: OWNER_ID }), survey())).toEqual(OWNER_COLUMN.sort());
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

describe('resolveSurveyCapabilities — 계정 유형', () => {
  it('게스트·실사는 부여 모델이 붙기 전까지 기본 거부다', () => {
    expect(caps(subject({ userType: 'guest' }), survey())).toEqual([]);
    expect(caps(subject({ userType: 'fieldwork' }), survey())).toEqual([]);
    // 참여자 행이 있어도 아직 열리지 않는다 — 티켓 21·24 가 이 자리를 채운다.
    expect(caps(subject({ userType: 'guest' }), survey(), { kind: 'guest' })).toEqual([]);
    expect(caps(subject({ userType: 'fieldwork' }), survey(), { kind: 'fieldwork' })).toEqual([]);
  });

  it('유형 게이트는 슈퍼어드민 플래그보다 먼저다', () => {
    // isSuperadmin 은 internal 전용 플래그다 — 비내부 계정에 실려 와도 열지 않는다.
    expect(caps(subject({ userType: 'guest', isSuperadmin: true }), survey())).toEqual([]);
  });
});
