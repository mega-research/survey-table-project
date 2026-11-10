/**
 * 그룹 옮기기 procedure 의 관문 (설문 그룹 중첩 티켓 05).
 *
 * `workspace.surveyGroups.relocate` 는 그룹을 통째로 다른 그룹 밑이나 최상위로 옮긴다 — 설문 한 건의
 * 그룹 이동(`move`)과 다른 표면이다. 여기서 고정하는 것은 관문이 **두 겹**이라는 사실이다.
 *
 * - 옮기는 그룹: 그 그룹의 소유 팀으로 그룹 구조 관문을 묻는다(슈퍼어드민 또는 그 팀 active 멤버).
 *   타 팀 그룹은 없는 그룹과 같은 NOT_FOUND 다.
 * - 새 상위: **옮기는 그룹과 같은 팀의** 그룹이어야 한다. 이것을 묻지 않으면 내 팀 그룹에 남의 팀
 *   그룹 id 를 짝지은 요청이 서비스까지 간다.
 */
import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';
import { getActiveTeamMemberships } from '@/server/read-models/team-memberships';

import {
  DuplicateSurveyGroupNameError,
  SurveyGroupNotFoundError,
  SurveyGroupRelocationCycleError,
  SurveyGroupRelocationTooDeepError,
} from '../domain/survey-groups';
import * as svc from '../services/survey-groups';
import { surveyGroups } from './survey-groups';

vi.mock('../services/survey-groups', () => ({
  getSurveyGroupTeamId: vi.fn(),
  relocateSurveyGroup: vi.fn(),
}));

vi.mock('@/server/read-models/team-memberships', () => ({ getActiveTeamMemberships: vi.fn() }));

vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityBatchRpc: vi.fn() }));

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_A = '22222222-2222-4222-8222-222222222222';
const TEAM_B = '33333333-3333-4333-8333-333333333333';
const GROUP_A = '44444444-4444-4444-8444-444444444444';
const GROUP_A2 = '44444444-4444-4444-8444-555555555555';
const GROUP_B = '55555555-5555-4555-8555-555555555555';
const UNKNOWN = '88888888-8888-4888-8888-888888888888';

function context(opts: { isSuperadmin?: boolean } = {}): ORPCContext {
  return {
    db: {} as never,
    user: {
      id: MEMBER_ID,
      email: 'member@megaresearch.co.kr',
      name: '김팀원',
      status: 'active',
      isSuperadmin: opts.isSuperadmin ?? false,
      userType: 'internal',
    },
    headers: new Headers(),
  };
}

function clientWith(opts: Parameters<typeof context>[0] = {}) {
  return createRouterClient({ surveyGroups }, { context: context(opts) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(svc.relocateSurveyGroup).mockResolvedValue({ success: true });
  // 그룹 A·A2 는 팀 A 것, 그룹 B 는 팀 B 것.
  vi.mocked(svc.getSurveyGroupTeamId).mockImplementation(async (groupId) =>
    groupId === GROUP_A || groupId === GROUP_A2 ? TEAM_A : groupId === GROUP_B ? TEAM_B : null,
  );
  // 요청자는 팀 A 의 **팀원**(팀장 아님) — 그룹 구조는 팀 공용이라 이걸로 충분해야 한다.
  vi.mocked(getActiveTeamMemberships).mockResolvedValue([
    {
      teamId: TEAM_A,
      teamName: '연구1본부 - 1팀',
      teamOrder: 0,
      teamKind: 'standard',
      role: 'member',
    },
  ]);
});

describe('그룹 옮기기 — 옮기는 그룹과 새 상위 양쪽 관문', () => {
  it('팀원이 내 팀 그룹을 같은 팀의 다른 그룹 밑으로, 또 최상위로 옮긴다', async () => {
    const client = clientWith();

    await client.surveyGroups.relocate({ groupId: GROUP_A, parentGroupId: GROUP_A2 });
    await client.surveyGroups.relocate({ groupId: GROUP_A, parentGroupId: null });

    expect(svc.relocateSurveyGroup).toHaveBeenNthCalledWith(1, {
      groupId: GROUP_A,
      parentGroupId: GROUP_A2,
    });
    expect(svc.relocateSurveyGroup).toHaveBeenNthCalledWith(2, {
      groupId: GROUP_A,
      parentGroupId: null,
    });
  });

  it('타 팀 그룹과 없는 그룹은 똑같이 NOT_FOUND 다 — 서비스에 닿지 않는다', async () => {
    const client = clientWith();

    for (const groupId of [GROUP_B, UNKNOWN]) {
      await expect(
        client.surveyGroups.relocate({ groupId, parentGroupId: null }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: '그룹을 찾을 수 없습니다.' });
    }

    expect(svc.relocateSurveyGroup).not.toHaveBeenCalled();
  });

  it('새 상위가 다른 팀의 그룹이거나 없는 그룹이면 NOT_FOUND — 서비스에 닿지 않는다', async () => {
    const client = clientWith();

    // 둘이 같은 응답이어야 id 스캔으로 타 팀 그룹의 존재가 확인되지 않는다.
    for (const parentGroupId of [GROUP_B, UNKNOWN]) {
      await expect(
        client.surveyGroups.relocate({ groupId: GROUP_A, parentGroupId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: '그룹을 찾을 수 없습니다.' });
    }

    expect(svc.relocateSurveyGroup).not.toHaveBeenCalled();
  });

  it('슈퍼어드민도 새 상위는 옮기는 그룹과 같은 팀이어야 한다', async () => {
    const client = clientWith({ isSuperadmin: true });

    // 소속을 묻지 않는 것은 「어느 팀의 그룹이든 만질 수 있다」이지 「팀을 건너 옮긴다」가 아니다.
    await client.surveyGroups.relocate({ groupId: GROUP_B, parentGroupId: null });
    await expect(
      client.surveyGroups.relocate({ groupId: GROUP_B, parentGroupId: GROUP_A }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(getActiveTeamMemberships).not.toHaveBeenCalled();
    expect(svc.relocateSurveyGroup).toHaveBeenCalledTimes(1);
  });

  it('새 상위를 빠뜨린 요청은 「최상위로」가 아니라 입력 오류다', async () => {
    const client = clientWith();

    await expect(
      client.surveyGroups.relocate({ groupId: GROUP_A } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(svc.relocateSurveyGroup).not.toHaveBeenCalled();
  });
});

describe('그룹 옮기기의 거부 — 사유마다 읽을 문구가 나간다', () => {
  it('자기 하위·3단계 초과·같은 이름은 CONFLICT, 그 사이 사라진 그룹은 NOT_FOUND', async () => {
    const client = clientWith();
    const call = () => client.surveyGroups.relocate({ groupId: GROUP_A, parentGroupId: GROUP_A2 });

    vi.mocked(svc.relocateSurveyGroup).mockRejectedValue(new SurveyGroupRelocationCycleError());
    await expect(call()).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '그룹을 자기 자신이나 자기 하위 그룹 밑으로 옮길 수 없습니다.',
    });

    vi.mocked(svc.relocateSurveyGroup).mockRejectedValue(new SurveyGroupRelocationTooDeepError());
    await expect(call()).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '이 자리로 옮기면 그룹이 3단계를 넘습니다.',
    });

    vi.mocked(svc.relocateSurveyGroup).mockRejectedValue(new DuplicateSurveyGroupNameError());
    await expect(call()).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '같은 이름의 그룹이 이미 있습니다.',
    });

    vi.mocked(svc.relocateSurveyGroup).mockRejectedValue(new SurveyGroupNotFoundError());
    await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
