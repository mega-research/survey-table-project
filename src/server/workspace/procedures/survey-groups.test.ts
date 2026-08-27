/**
 * 설문 그룹 procedure 의 관문 (역할 모델 v2 티켓 12).
 *
 * 여기서 고정하는 것은 관문이 **두 갈래**라는 사실이다.
 *
 * - 그룹 구조(생성·이름 변경·정렬·삭제·목록)는 팀 공용이라 팀장·팀원을 가리지 않지만
 *   **입력의 teamId 로** 판정한다. "어딘가의 팀원" 이면 통과시키는 순간 A팀 팀원이 B팀
 *   그룹을 만든다.
 * - 설문을 넣고 빼는 것은 그 설문의 survey.edit + surveyGroup.manage 를 둘 다 요구한다.
 *   전자만 보면 참여자(티켓 18)가 남의 팀 폴더 구조를 재배치하고, 후자만 보면 팀원이
 *   못 고치는 설문을 옮긴다.
 */
import { createRouterClient, ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

import {
  DuplicateSurveyGroupNameError,
  SurveyAlreadyGroupedError,
  SurveyGroupTargetNotFoundError,
  SurveyTeamMismatchError,
} from '../domain/survey-groups';
import * as svc from '../services/survey-groups';
import { getActiveTeamMemberships } from '@/server/read-models/team-memberships';
import { assertSurveyCapabilityBatchRpc } from '@/server/rpc-survey-access';
import { surveyGroups } from './survey-groups';

vi.mock('../services/survey-groups', () => ({
  listSurveyGroups: vi.fn(),
  getSurveyGroupTeamId: vi.fn(),
  createSurveyGroup: vi.fn(),
  renameSurveyGroup: vi.fn(),
  reorderSurveyGroups: vi.fn(),
  removeSurveyGroup: vi.fn(),
  listUngroupedSurveys: vi.fn(),
  collectSurveysIntoGroup: vi.fn(),
  moveSurveyToGroup: vi.fn(),
}));

vi.mock('@/server/read-models/team-memberships', () => ({ getActiveTeamMemberships: vi.fn() }));

vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityBatchRpc: vi.fn() }));

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_A = '22222222-2222-4222-8222-222222222222';
const TEAM_B = '33333333-3333-4333-8333-333333333333';
const GROUP_A = '44444444-4444-4444-8444-444444444444';
const GROUP_B = '55555555-5555-4555-8555-555555555555';
const SURVEY_1 = '66666666-6666-4666-8666-666666666666';
const SURVEY_2 = '77777777-7777-4777-8777-777777777777';

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
  // clearAllMocks 는 호출 기록만 지우고 구현은 남긴다 — mockRejectedValue 를 심는
  // 케이스가 있으므로 기본 통과 구현을 매번 다시 깔아야 다음 테스트로 새지 않는다.
  vi.clearAllMocks();
  vi.mocked(assertSurveyCapabilityBatchRpc).mockResolvedValue(undefined);
  vi.mocked(svc.listSurveyGroups).mockResolvedValue([]);
  vi.mocked(svc.createSurveyGroup).mockResolvedValue({ id: GROUP_A });
  vi.mocked(svc.renameSurveyGroup).mockResolvedValue({ success: true });
  vi.mocked(svc.reorderSurveyGroups).mockResolvedValue({ success: true });
  vi.mocked(svc.removeSurveyGroup).mockResolvedValue({ success: true });
  vi.mocked(svc.listUngroupedSurveys).mockResolvedValue([]);
  vi.mocked(svc.collectSurveysIntoGroup).mockResolvedValue({ success: true });
  vi.mocked(svc.moveSurveyToGroup).mockResolvedValue({ success: true });
  // 그룹 A 는 팀 A 것, 그룹 B 는 팀 B 것.
  vi.mocked(svc.getSurveyGroupTeamId).mockImplementation(async (groupId) =>
    groupId === GROUP_A ? TEAM_A : groupId === GROUP_B ? TEAM_B : null,
  );
  // 요청자는 팀 A 의 **팀원**(팀장 아님) — 그룹 구조는 팀 공용이라 이걸로 충분해야 한다.
  vi.mocked(getActiveTeamMemberships).mockResolvedValue([
    { teamId: TEAM_A, teamName: '연구1본부 - 1팀', teamOrder: 0, role: 'member' },
  ]);
});

describe('그룹 구조 표면 — 팀 공용, 입력 teamId 로 판정', () => {
  it('팀장이 아닌 팀원도 생성·정렬·목록·후보 조회를 할 수 있다', async () => {
    const client = clientWith();

    await client.surveyGroups.list({ teamId: TEAM_A });
    await client.surveyGroups.create({ teamId: TEAM_A, name: '2026 상반기' });
    await client.surveyGroups.reorder({ teamId: TEAM_A, orderedGroupIds: [GROUP_A] });
    await client.surveyGroups.listUngrouped({ teamId: TEAM_A, query: '' });

    expect(svc.listSurveyGroups).toHaveBeenCalledWith(TEAM_A);
    expect(svc.createSurveyGroup).toHaveBeenCalledWith(MEMBER_ID, {
      teamId: TEAM_A,
      name: '2026 상반기',
    });
    expect(svc.reorderSurveyGroups).toHaveBeenCalledTimes(1);
    expect(svc.listUngroupedSurveys).toHaveBeenCalledTimes(1);
  });

  it('타 팀 teamId 는 FORBIDDEN — 서비스에 닿지 않는다', async () => {
    const client = clientWith();

    for (const call of [
      client.surveyGroups.list({ teamId: TEAM_B }),
      client.surveyGroups.create({ teamId: TEAM_B, name: '남의 팀 그룹' }),
      client.surveyGroups.reorder({ teamId: TEAM_B, orderedGroupIds: [GROUP_B] }),
      client.surveyGroups.listUngrouped({ teamId: TEAM_B, query: '' }),
    ]) {
      await expect(call).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }

    expect(svc.listSurveyGroups).not.toHaveBeenCalled();
    expect(svc.createSurveyGroup).not.toHaveBeenCalled();
    expect(svc.reorderSurveyGroups).not.toHaveBeenCalled();
    expect(svc.listUngroupedSurveys).not.toHaveBeenCalled();
  });

  it('슈퍼어드민은 소속을 묻지 않고 통과한다', async () => {
    const client = clientWith({ isSuperadmin: true });

    await client.surveyGroups.list({ teamId: TEAM_B });

    expect(svc.listSurveyGroups).toHaveBeenCalledWith(TEAM_B);
    expect(getActiveTeamMemberships).not.toHaveBeenCalled();
  });
});

describe('groupId 만 받는 표면 — 타 팀 그룹은 존재를 감춘다', () => {
  it('내 팀 그룹은 이름 변경·삭제가 된다', async () => {
    const client = clientWith();

    await client.surveyGroups.rename({ groupId: GROUP_A, name: '2025' });
    await client.surveyGroups.remove({ groupId: GROUP_A });

    expect(svc.renameSurveyGroup).toHaveBeenCalledWith({ groupId: GROUP_A, name: '2025' });
    expect(svc.removeSurveyGroup).toHaveBeenCalledWith(GROUP_A);
  });

  it('타 팀 그룹과 없는 그룹은 똑같이 NOT_FOUND 다', async () => {
    const client = clientWith();
    const UNKNOWN = '88888888-8888-4888-8888-888888888888';

    for (const call of [
      client.surveyGroups.rename({ groupId: GROUP_B, name: '가로채기' }),
      client.surveyGroups.remove({ groupId: GROUP_B }),
      client.surveyGroups.rename({ groupId: UNKNOWN, name: '없는 그룹' }),
      client.surveyGroups.remove({ groupId: UNKNOWN }),
    ]) {
      await expect(call).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }

    expect(svc.renameSurveyGroup).not.toHaveBeenCalled();
    expect(svc.removeSurveyGroup).not.toHaveBeenCalled();
  });
});

describe('설문 담기 — 그룹 관문 + 설문별 capability', () => {
  it('두 관문을 모두 지나고 survey.edit·surveyGroup.manage 를 함께 요구한다', async () => {
    const client = clientWith();

    await client.surveyGroups.collect({ groupId: GROUP_A, surveyIds: [SURVEY_1, SURVEY_2] });

    expect(assertSurveyCapabilityBatchRpc).toHaveBeenCalledWith(
      context().user,
      [SURVEY_1, SURVEY_2],
      ['survey.edit', 'surveyGroup.manage'],
    );
    expect(svc.collectSurveysIntoGroup).toHaveBeenCalledTimes(1);
  });

  it('같은 설문 id 가 중복되면 한 번으로 접는다', async () => {
    const client = clientWith();

    await client.surveyGroups.collect({
      groupId: GROUP_A,
      surveyIds: [SURVEY_1, SURVEY_1, SURVEY_2],
    });

    expect(svc.collectSurveysIntoGroup).toHaveBeenCalledWith({
      groupId: GROUP_A,
      surveyIds: [SURVEY_1, SURVEY_2],
    });
  });

  it('타 팀 그룹이면 설문 관문까지 가지 않는다', async () => {
    const client = clientWith();

    await expect(
      client.surveyGroups.collect({ groupId: GROUP_B, surveyIds: [SURVEY_1] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(assertSurveyCapabilityBatchRpc).not.toHaveBeenCalled();
    expect(svc.collectSurveysIntoGroup).not.toHaveBeenCalled();
  });

  it('설문 하나라도 권한이 없으면 서비스에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityBatchRpc).mockRejectedValue(
      new ORPCError('FORBIDDEN', { message: '이 작업을 수행할 권한이 없습니다.' }),
    );
    const client = clientWith();

    await expect(
      client.surveyGroups.collect({ groupId: GROUP_A, surveyIds: [SURVEY_1, SURVEY_2] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(svc.collectSurveysIntoGroup).not.toHaveBeenCalled();
  });
});

describe('단건 이동 — 설문 capability 가 판정의 전부', () => {
  it('그룹으로 옮길 때도 미분류로 뺄 때도 같은 짝을 요구한다', async () => {
    const client = clientWith();

    await client.surveyGroups.move({ surveyId: SURVEY_1, groupId: GROUP_A });
    await client.surveyGroups.move({ surveyId: SURVEY_1, groupId: null });

    expect(assertSurveyCapabilityBatchRpc).toHaveBeenNthCalledWith(
      1,
      context().user,
      [SURVEY_1],
      ['survey.edit', 'surveyGroup.manage'],
    );
    expect(assertSurveyCapabilityBatchRpc).toHaveBeenNthCalledWith(
      2,
      context().user,
      [SURVEY_1],
      ['survey.edit', 'surveyGroup.manage'],
    );
    expect(svc.moveSurveyToGroup).toHaveBeenCalledTimes(2);
  });

  it('편집 권한이 없으면 서비스에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityBatchRpc).mockRejectedValue(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = clientWith();

    await expect(
      client.surveyGroups.move({ surveyId: SURVEY_1, groupId: GROUP_A }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(svc.moveSurveyToGroup).not.toHaveBeenCalled();
  });
});

describe('도메인 에러 → RPC 코드', () => {
  it('이름 중복·이미 담김·팀 불일치는 CONFLICT, 대상 없음은 NOT_FOUND', async () => {
    const client = clientWith();

    vi.mocked(svc.createSurveyGroup).mockRejectedValue(new DuplicateSurveyGroupNameError());
    await expect(
      client.surveyGroups.create({ teamId: TEAM_A, name: '2025' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: '같은 이름의 그룹이 이미 있습니다.' });

    vi.mocked(svc.collectSurveysIntoGroup).mockRejectedValue(new SurveyAlreadyGroupedError());
    await expect(
      client.surveyGroups.collect({ groupId: GROUP_A, surveyIds: [SURVEY_1] }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: '미분류 설문만 담을 수 있습니다.' });

    vi.mocked(svc.moveSurveyToGroup).mockRejectedValue(new SurveyTeamMismatchError());
    await expect(
      client.surveyGroups.move({ surveyId: SURVEY_1, groupId: GROUP_A }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    vi.mocked(svc.moveSurveyToGroup).mockRejectedValue(new SurveyGroupTargetNotFoundError());
    await expect(
      client.surveyGroups.move({ surveyId: SURVEY_1, groupId: null }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: '설문을 찾을 수 없습니다.' });
  });
});
