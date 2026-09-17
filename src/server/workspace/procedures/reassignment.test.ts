/**
 * 재배치 센터 procedure 의 권한 축과 에러 어휘 (역할 모델 v2 티켓 14).
 *
 * 여기서 고정할 것은 둘이다.
 *  ① **전 표면이 슈퍼어드민 전용**이다. 인박스의 사람과 설문은 어느 팀에도 속하지 않아 팀
 *     경계로 좁힐 수 없다 — 팀장에게 하나라도 열리면 그 순간 전사 열람이 된다.
 *  ② 거부의 어휘. 「상태가 이미 바뀌었다」는 CONFLICT(목록을 새로 읽으면 된다)이고, 「화면이
 *     고를 수 없는 조합」은 BAD_REQUEST 다. 500 으로 새면 화면이 아무 말도 못 한다.
 */
import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

import {
  OwnerNotInTeamError,
  SurveyNotPendingError,
  UserAlreadyAssignedError,
} from '../domain/reassignment';
import { TargetUserNotFoundError, TeamNotFoundError } from '../domain/teams';
import * as svc from '../services/reassignment';
import { reassignment } from './reassignment';

vi.mock('../services/reassignment', () => ({
  getReassignmentInbox: vi.fn(),
  getPendingSurvey: vi.fn(),
  listOwnerCandidates: vi.fn(),
  assignUserToTeam: vi.fn(),
  assignSurveys: vi.fn(),
}));

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SURVEY_ID = '44444444-4444-4444-8444-444444444444';

function clientWith(opts: { isSuperadmin?: boolean } = {}) {
  const context: ORPCContext = {
    db: {} as never,
    user: {
      id: ACTOR_ID,
      email: 'actor@megaresearch.co.kr',
      name: '박팀장',
      status: 'active',
      isSuperadmin: opts.isSuperadmin ?? false,
      userType: 'internal',
    },
    headers: new Headers(),
  };
  return createRouterClient({ reassignment }, { context });
}

const EMPTY_INBOX = {
  summary: { archivedTeamCount: 0, unassignedUserCount: 0, pendingSurveyCount: 0 },
  unassignedUsers: [],
  pendingSurveys: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(svc.getReassignmentInbox).mockResolvedValue(EMPTY_INBOX);
  vi.mocked(svc.getPendingSurvey).mockResolvedValue(null);
  vi.mocked(svc.listOwnerCandidates).mockResolvedValue([]);
  vi.mocked(svc.assignUserToTeam).mockResolvedValue({ success: true });
  vi.mocked(svc.assignSurveys).mockResolvedValue({ assignedCount: 1 });
});

const CALLS: [string, (c: ReturnType<typeof clientWith>) => Promise<unknown>][] = [
  ['inbox', (c) => c.reassignment.inbox()],
  ['pendingSurvey', (c) => c.reassignment.pendingSurvey({ surveyId: SURVEY_ID })],
  ['ownerCandidates', (c) => c.reassignment.ownerCandidates({ teamId: TEAM_ID })],
  [
    'assignUser',
    (c) =>
      c.reassignment.assignUser({
        userId: USER_ID,
        teamId: TEAM_ID,
        role: 'member',
        jobTitle: null,
      }),
  ],
  [
    'assignSurveys',
    (c) =>
      c.reassignment.assignSurveys({
        surveyIds: [SURVEY_ID],
        teamId: TEAM_ID,
        ownerUserId: USER_ID,
        visibility: 'team',
      }),
  ],
];

describe('재배치 센터 procedure', () => {
  it.each(CALLS)('%s 는 슈퍼어드민이 아니면 거부한다', async (_name, call) => {
    await expect(call(clientWith({ isSuperadmin: false }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it.each(CALLS)('%s 는 슈퍼어드민이면 통과한다', async (_name, call) => {
    await expect(call(clientWith({ isSuperadmin: true }))).resolves.toBeDefined();
  });

  it('표면은 다섯 개뿐이다 — 되돌리기·강제 배정 같은 뒷문이 없다', () => {
    // 인박스는 「처리하는」 곳이지 「되돌리는」 곳이 아니다. 팀 해산에 취소가 없는 것과 같은
    // 이유로(ADR-0011) 배치 취소도 없다 — 되돌리려면 정식 이전(티켓 19)을 쓴다.
    expect(Object.keys(reassignment).sort()).toEqual([
      'assignSurveys',
      'assignUser',
      'inbox',
      'ownerCandidates',
      'pendingSurvey',
    ]);
  });

  it('일괄 배치는 200건을 넘기면 입력에서 거부한다', async () => {
    const ids = Array.from(
      { length: 201 },
      (_, i) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
    );
    await expect(
      clientWith({ isSuperadmin: true }).reassignment.assignSurveys({
        surveyIds: ids,
        teamId: TEAM_ID,
        ownerUserId: USER_ID,
        visibility: 'team',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.assignSurveys).not.toHaveBeenCalled();
  });

  it('빈 선택은 입력에서 거부한다 — 서버가 0건을 성공으로 세지 않는다', async () => {
    await expect(
      clientWith({ isSuperadmin: true }).reassignment.assignSurveys({
        surveyIds: [],
        teamId: TEAM_ID,
        ownerUserId: USER_ID,
        visibility: 'team',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('중복 id 는 계약이 접는다 — 같은 설문을 두 번 세지 않는다', async () => {
    await clientWith({ isSuperadmin: true }).reassignment.assignSurveys({
      surveyIds: [SURVEY_ID, SURVEY_ID],
      teamId: TEAM_ID,
      ownerUserId: USER_ID,
      visibility: 'team',
    });
    expect(svc.assignSurveys).toHaveBeenCalledWith(
      ACTOR_ID,
      expect.objectContaining({ surveyIds: [SURVEY_ID] }),
    );
  });

  describe('거부 어휘', () => {
    it('이미 배정된 사용자는 CONFLICT — 목록이 낡았을 뿐이다', async () => {
      vi.mocked(svc.assignUserToTeam).mockRejectedValue(new UserAlreadyAssignedError());
      await expect(
        clientWith({ isSuperadmin: true }).reassignment.assignUser({
          userId: USER_ID,
          teamId: TEAM_ID,
          role: 'member',
          jobTitle: null,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('배치 대기가 아닌 설문이 섞이면 CONFLICT', async () => {
      vi.mocked(svc.assignSurveys).mockRejectedValue(new SurveyNotPendingError(SURVEY_ID));
      await expect(
        clientWith({ isSuperadmin: true }).reassignment.assignSurveys({
          surveyIds: [SURVEY_ID],
          teamId: TEAM_ID,
          ownerUserId: USER_ID,
          visibility: 'team',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('팀 밖 소유자는 BAD_REQUEST — 화면이 고를 수 없는 조합이라 상태 변화가 아니다', async () => {
      vi.mocked(svc.assignSurveys).mockRejectedValue(new OwnerNotInTeamError());
      await expect(
        clientWith({ isSuperadmin: true }).reassignment.assignSurveys({
          surveyIds: [SURVEY_ID],
          teamId: TEAM_ID,
          ownerUserId: USER_ID,
          visibility: 'team',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('없는 팀·없는 사용자는 NOT_FOUND', async () => {
      vi.mocked(svc.assignUserToTeam).mockRejectedValue(new TeamNotFoundError());
      await expect(
        clientWith({ isSuperadmin: true }).reassignment.assignUser({
          userId: USER_ID,
          teamId: TEAM_ID,
          role: 'member',
          jobTitle: null,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      vi.mocked(svc.assignUserToTeam).mockRejectedValue(new TargetUserNotFoundError());
      await expect(
        clientWith({ isSuperadmin: true }).reassignment.assignUser({
          userId: USER_ID,
          teamId: TEAM_ID,
          role: 'member',
          jobTitle: null,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
