/**
 * 배치 capability 관문 (역할 모델 v2 티켓 12).
 *
 * 「설문 담기」가 한 요청으로 최대 200건을 받는다. 여기서 고정하는 것은 셋이다 —
 * ① 판정 결과가 단건 관문과 같다 ② 없는 설문 id 는 not_found 로 접힌다(존재 은닉)
 * ③ 요구 capability 는 **모두** 있어야 하고 하나라도 막히면 전부 거부한다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SurveyAssignmentStatus, SurveyVisibility } from '@/shared/contracts/workspace';

interface Row {
  id: string;
  teamId: string | null;
  visibility: SurveyVisibility;
  ownerUserId: string | null;
  assignmentStatus: SurveyAssignmentStatus;
}

const surveyRows: Row[] = [];

vi.mock('@/db', () => {
  const result = () => {
    const rows = Promise.resolve(surveyRows);
    return Object.assign(rows, { limit: () => Promise.resolve(surveyRows.slice(0, 1)) });
  };
  return { db: { select: () => ({ from: () => ({ where: result }) }) } };
});

vi.mock('./read-models/team-memberships', () => ({ getActiveTeamMemberships: vi.fn() }));

import { getActiveTeamMemberships } from './read-models/team-memberships';
import {
  assertSurveyCapabilityBatch,
  loadSurveyCapabilitiesBatch,
  SurveyAccessError,
} from './survey-access';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER = { id: '33333333-3333-4333-8333-333333333333', isSuperadmin: false } as const;
const user = { ...MEMBER, userType: 'internal' as const };

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const MISSING = 'cccccccc-3333-4333-8333-333333333333';

function row(over: Partial<Row> & { id: string }): Row {
  return {
    teamId: TEAM_ID,
    visibility: 'team',
    ownerUserId: null,
    assignmentStatus: 'assigned',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  surveyRows.length = 0;
  vi.mocked(getActiveTeamMemberships).mockResolvedValue([
    { teamId: TEAM_ID, teamName: '연구1본부 - 1팀', teamOrder: 0, role: 'member' },
  ]);
});

describe('loadSurveyCapabilitiesBatch', () => {
  it('행이 없는 id 는 맵에 담기지 않는다 — 호출부가 not_found 로 접는다', async () => {
    surveyRows.push(row({ id: A }));

    const caps = await loadSurveyCapabilitiesBatch(user, [A, MISSING]);

    expect(caps.get(A)?.has('surveyGroup.manage')).toBe(true);
    expect(caps.has(MISSING)).toBe(false);
  });

  it('멤버십은 설문 수와 무관하게 한 번만 읽는다', async () => {
    surveyRows.push(row({ id: A }), row({ id: B }));

    await loadSurveyCapabilitiesBatch(user, [A, B]);

    expect(getActiveTeamMemberships).toHaveBeenCalledTimes(1);
  });

  it('빈 목록은 왕복하지 않는다', async () => {
    const caps = await loadSurveyCapabilitiesBatch(user, []);

    expect(caps.size).toBe(0);
    expect(getActiveTeamMemberships).not.toHaveBeenCalled();
  });
});

describe('assertSurveyCapabilityBatch', () => {
  it('전부 가지고 있으면 통과한다', async () => {
    surveyRows.push(row({ id: A }), row({ id: B }));

    await expect(
      assertSurveyCapabilityBatch(user, [A, B], ['survey.edit', 'surveyGroup.manage']),
    ).resolves.toBeUndefined();
  });

  it('타 팀 설문이 하나라도 섞이면 not_found 로 전부 거부한다', async () => {
    surveyRows.push(row({ id: A }), row({ id: B, teamId: OTHER_TEAM_ID }));

    await expect(
      assertSurveyCapabilityBatch(user, [A, B], ['survey.edit']),
    ).rejects.toMatchObject({ reason: 'not_found' });
  });

  it('없는 설문 id 는 not_found — 존재를 알려주지 않는다', async () => {
    surveyRows.push(row({ id: A }));

    await expect(
      assertSurveyCapabilityBatch(user, [A, MISSING], ['survey.edit']),
    ).rejects.toBeInstanceOf(SurveyAccessError);
  });

  it('빈 목록은 통과가 아니라 거부다 — 단건 관문과 기본값 방향을 맞춘다', async () => {
    await expect(assertSurveyCapabilityBatch(user, [], ['survey.edit'])).rejects.toMatchObject({
      reason: 'not_found',
    });
    expect(getActiveTeamMemberships).not.toHaveBeenCalled();
  });

  it('보이지만 요구 capability 하나가 없으면 forbidden 이다', async () => {
    // 팀원은 팀 공개 설문에 survey.publish 가 없다(스펙 §8) — 볼 수는 있으므로 forbidden.
    surveyRows.push(row({ id: A }));

    await expect(
      assertSurveyCapabilityBatch(user, [A], ['survey.edit', 'survey.publish']),
    ).rejects.toMatchObject({ reason: 'forbidden' });
  });
});
