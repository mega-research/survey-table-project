/**
 * 설문 참여자 왕복 + 음성 스위트 (역할 모델 v2 티켓 18) — 실 로컬 DB.
 *
 * 참여는 **팀 경계를 넘는 유일한 접근 경로**다. 지금까지 설문 접근은 전부 `surveys.teamId` 를
 * 지나 판정됐는데(ADR-0006·0008) 이 축만 그 밖에 있다. 그래서 이 스위트가 묻는 것은 하나다 —
 * **초대가 열어주는 것이 정확히 그 설문 하나인가.**
 *
 * 실 DB 인 이유: 판정이 순수 함수라도 그 입력(참여 행)을 **설문 행과 같은 쿼리에서 조인해**
 * 읽고, 목록은 `exists` 서브쿼리로 붙는다. 목이 돌려주는 행은 언제나 테스트가 정한 행이라
 * 조인·서브쿼리가 무엇이든 통과한다(티켓 15·17 과 같은 이유).
 *
 * 축 넷:
 *  ① 초대받은 설문 **하나만** 열린다 — 같은 팀의 다른 설문·그룹·멤버십은 그대로다.
 *  ② invite_only 도 참여자에게는 열린다(스펙 §3 — 숨기는 대상은 소유 팀 팀원뿐).
 *  ③ capability 가 스펙 §8 의 참여자 열과 정확히 같다 — 편집·운영·삭제는 되고 발행·공유
 *     관리·이전은 안 된다.
 *  ④ 추가와 제외의 권한 축이 다르다 — 추가는 접근자 누구나, 제외는 소유자·팀장·슈퍼어드민.
 */
import { createRouterClient } from '@orpc/server';
import { count, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  surveyParticipants as participantsTable,
  surveys as surveysTable,
  teamMembers as teamMembersTable,
  teams as teamsTable,
  users as usersTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';
import { getScopedSurveys } from '@/server/read-models/survey-structure';
import { loadAccessSubject, loadSurveyCapabilities } from '@/server/survey-access';
import { buildSurveyScopeFilter } from '@/server/work-scope';
import { participants as participantsProcedures } from '@/server/workspace/procedures/participants';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

/** A팀 — 설문 소유 팀. */
const A_OWNER_ID = crypto.randomUUID();
const A_LEADER_ID = crypto.randomUUID();
const A_MEMBER_ID = crypto.randomUUID();
/** B팀 — 초대받는 쪽. 이 사람은 A팀과 아무 관계가 없다. */
const B_OUTSIDER_ID = crypto.randomUUID();
const SUPERADMIN_ID = crypto.randomUUID();
/** 초대 불가 계정 — 유형 정합 검증용. */
const GUEST_ID = crypto.randomUUID();
const DEPARTED_ID = crypto.randomUUID();

const TEAM_A = crypto.randomUUID();
const TEAM_B = crypto.randomUUID();

const ALL_USER_IDS = [
  A_OWNER_ID,
  A_LEADER_ID,
  A_MEMBER_ID,
  B_OUTSIDER_ID,
  SUPERADMIN_ID,
  GUEST_ID,
  DEPARTED_ID,
];

/** 초대 대상 설문 + 같은 팀의 이웃 설문(초대가 새는지 보는 대조군). */
let surveyId = '';
let neighbourSurveyId = '';

function contextFor(userId: string, isSuperadmin = false): ORPCContext {
  return {
    db,
    user: {
      id: userId,
      email: `participants-${userId}@example.com`,
      name: '참여테스터',
      status: 'active',
      isSuperadmin,
      userType: 'internal',
    },
  };
}

function clientFor(userId: string, isSuperadmin = false) {
  return createRouterClient(
    { participants: participantsProcedures },
    { context: contextFor(userId, isSuperadmin) },
  );
}

function subjectOf(userId: string, isSuperadmin = false) {
  return { id: userId, isSuperadmin, userType: 'internal' as const };
}

async function seedUser(
  id: string,
  over: { userType?: 'internal' | 'guest'; status?: 'active' | 'departed'; isSuperadmin?: boolean } = {},
): Promise<void> {
  await db.insert(usersTable).values({
    id,
    name: `사용자-${id.slice(0, 4)}`,
    email: `participants-${id}@example.com`,
    emailVerified: true,
    status: over.status ?? 'active',
    isSuperadmin: over.isSuperadmin ?? false,
    userType: over.userType ?? 'internal',
  });
}

async function seedSurvey(title: string, visibility: 'team' | 'invite_only'): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(surveysTable).values({
    id,
    title,
    teamId: TEAM_A,
    visibility,
    assignmentStatus: 'assigned',
    ownerUserId: A_OWNER_ID,
    createdBy: A_OWNER_ID,
  });
  return id;
}

/** 그 사람이 팀 범위에서 실제로 보는 설문 id — 목록 SQL 을 그대로 지난다. */
async function visibleIds(userId: string, teamId: string): Promise<string[]> {
  const subject = await loadAccessSubject(subjectOf(userId));
  const rows = await getScopedSurveys(buildSurveyScopeFilter(subject, { kind: 'team', teamId }));
  return rows.map((row) => row.id);
}

async function caps(userId: string, id = surveyId): Promise<string[]> {
  return [...(await loadSurveyCapabilities(subjectOf(userId), id))];
}

describe.skipIf(!isLocalDb)('설문 참여자 (real local DB)', () => {
  beforeAll(async () => {
    if (!isLocalDb) return;
    await seedUser(A_OWNER_ID);
    await seedUser(A_LEADER_ID);
    await seedUser(A_MEMBER_ID);
    await seedUser(B_OUTSIDER_ID);
    await seedUser(SUPERADMIN_ID, { isSuperadmin: true });
    await seedUser(GUEST_ID, { userType: 'guest' });
    await seedUser(DEPARTED_ID, { status: 'departed' });

    await db.insert(teamsTable).values([
      { id: TEAM_A, name: `참여팀A-${TEAM_A.slice(0, 8)}` },
      { id: TEAM_B, name: `참여팀B-${TEAM_B.slice(0, 8)}` },
    ]);
    await db.insert(teamMembersTable).values([
      { teamId: TEAM_A, userId: A_OWNER_ID, role: 'member' },
      { teamId: TEAM_A, userId: A_LEADER_ID, role: 'leader' },
      { teamId: TEAM_A, userId: A_MEMBER_ID, role: 'member' },
      { teamId: TEAM_B, userId: B_OUTSIDER_ID, role: 'member' },
      // 퇴사자도 소속 행은 남는다(퇴사가 team_members 를 지우지 않는다 — 티켓 14).
      { teamId: TEAM_B, userId: DEPARTED_ID, role: 'member' },
    ]);
  });

  beforeEach(async () => {
    if (!isLocalDb) return;
    if (surveyId) await db.delete(surveysTable).where(eq(surveysTable.id, surveyId));
    if (neighbourSurveyId) {
      await db.delete(surveysTable).where(eq(surveysTable.id, neighbourSurveyId));
    }
    surveyId = await seedSurvey('초대 대상 조사', 'team');
    neighbourSurveyId = await seedSurvey('같은 팀 이웃 조사', 'team');
  });

  afterAll(async () => {
    if (!isLocalDb) return;
    await db
      .delete(surveysTable)
      .where(inArray(surveysTable.id, [surveyId, neighbourSurveyId].filter(Boolean)));
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, ALL_USER_IDS));
    await db.delete(teamsTable).where(inArray(teamsTable.id, [TEAM_A, TEAM_B]));
    await db.delete(usersTable).where(inArray(usersTable.id, ALL_USER_IDS));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ① 초대가 여는 것은 그 설문 하나뿐이다
  // ───────────────────────────────────────────────────────────────────────────

  describe('초대는 설문 하나만 연다', () => {
    it('타 팀 사용자가 초대 전에는 아무것도 못 본다', async () => {
      expect(await caps(B_OUTSIDER_ID)).toEqual([]);
      expect(await visibleIds(B_OUTSIDER_ID, TEAM_B)).not.toContain(surveyId);
    });

    it('초대하면 그 설문만 열리고 이웃 설문·팀 멤버십은 그대로다', async () => {
      await clientFor(A_OWNER_ID).participants.add({ surveyId, userId: B_OUTSIDER_ID });

      // 열린 것 — 그 설문 하나.
      expect(await caps(B_OUTSIDER_ID)).toContain('survey.edit');
      expect(await visibleIds(B_OUTSIDER_ID, TEAM_B)).toContain(surveyId);

      // 안 열린 것 — 같은 팀의 다른 설문.
      expect(await caps(B_OUTSIDER_ID, neighbourSurveyId)).toEqual([]);
      expect(await visibleIds(B_OUTSIDER_ID, TEAM_B)).not.toContain(neighbourSurveyId);

      // 팀 멤버십은 만들어지지 않는다 — 초대는 팀 축 밖의 접근이다(스펙 §4).
      const [membership] = await db
        .select({ value: count() })
        .from(teamMembersTable)
        .where(eq(teamMembersTable.userId, B_OUTSIDER_ID));
      expect(membership?.value).toBe(1); // B팀 하나 그대로
    });

    it('제외하면 그 설문이 다시 닫힌다', async () => {
      const owner = clientFor(A_OWNER_ID);
      await owner.participants.add({ surveyId, userId: B_OUTSIDER_ID });
      await owner.participants.remove({ surveyId, userId: B_OUTSIDER_ID });

      expect(await caps(B_OUTSIDER_ID)).toEqual([]);
      expect(await visibleIds(B_OUTSIDER_ID, TEAM_B)).not.toContain(surveyId);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ② invite_only 도 참여자에게는 열린다
  // ───────────────────────────────────────────────────────────────────────────

  it('invite_only 설문도 참여자에게 열린다 — 숨기는 대상은 소유 팀 팀원뿐이다', async () => {
    await db
      .update(surveysTable)
      .set({ visibility: 'invite_only' })
      .where(eq(surveysTable.id, surveyId));

    await clientFor(A_OWNER_ID).participants.add({ surveyId, userId: B_OUTSIDER_ID });

    expect(await caps(B_OUTSIDER_ID)).toContain('survey.edit');
    expect(await visibleIds(B_OUTSIDER_ID, TEAM_B)).toContain(surveyId);
    // 같은 팀 팀원에게는 여전히 숨겨져 있다 — 그것이 invite_only 의 뜻이다(스펙 §3).
    expect(await caps(A_MEMBER_ID)).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ③ capability 가 스펙 §8 의 참여자 열과 같다
  // ───────────────────────────────────────────────────────────────────────────

  it('참여자 열: 편집·운영·응답·컨택·메일·export·삭제는 되고 발행·공유 관리·이전·그룹은 안 된다', async () => {
    await clientFor(A_OWNER_ID).participants.add({ surveyId, userId: B_OUTSIDER_ID });
    const granted = await caps(B_OUTSIDER_ID);

    // 스펙 §8 참여자 열에서 O 인 것 (⚠️가정 포함 — §11-1).
    for (const capability of [
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
    ]) {
      expect(granted, `참여자가 ${capability} 를 가져야 한다`).toContain(capability);
    }

    // 빠지는 것 — 설문 자체의 처분권과 팀 소유 구조.
    for (const capability of [
      'survey.publish',
      'survey.manageAccess',
      'survey.transferOwnership',
      'surveyGroup.manage',
    ]) {
      expect(granted, `참여자가 ${capability} 를 가지면 안 된다`).not.toContain(capability);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ④ 추가와 제외의 권한 축이 다르다
  // ───────────────────────────────────────────────────────────────────────────

  describe('추가는 접근자 누구나, 제외는 소유자·팀장·슈퍼어드민', () => {
    it('팀 공개 설문의 팀원도 초대할 수 있다', async () => {
      await clientFor(A_MEMBER_ID).participants.add({ surveyId, userId: B_OUTSIDER_ID });
      expect(await caps(B_OUTSIDER_ID)).toContain('survey.edit');
    });

    it('참여자 본인도 다른 사람을 초대할 수 있다 — 접근자 누구나(스펙 §4)', async () => {
      await clientFor(A_OWNER_ID).participants.add({ surveyId, userId: B_OUTSIDER_ID });
      await clientFor(B_OUTSIDER_ID).participants.add({ surveyId, userId: A_MEMBER_ID });

      const list = await clientFor(A_OWNER_ID).participants.list({ surveyId });
      expect(list.participants.map((p) => p.userId).sort()).toEqual(
        [B_OUTSIDER_ID, A_MEMBER_ID].sort(),
      );
    });

    it('팀원은 제외하지 못한다 — 목록의 canRemove 도 false 다', async () => {
      await clientFor(A_OWNER_ID).participants.add({ surveyId, userId: B_OUTSIDER_ID });

      const asMember = await clientFor(A_MEMBER_ID).participants.list({ surveyId });
      expect(asMember.canRemove).toBe(false);
      await expect(
        clientFor(A_MEMBER_ID).participants.remove({ surveyId, userId: B_OUTSIDER_ID }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // 참여자 자신도 못 뺀다 — 들이는 것과 내보내는 것은 무게가 다르다.
      await expect(
        clientFor(B_OUTSIDER_ID).participants.remove({ surveyId, userId: B_OUTSIDER_ID }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('팀장·슈퍼어드민은 제외할 수 있다', async () => {
      const owner = clientFor(A_OWNER_ID);
      await owner.participants.add({ surveyId, userId: B_OUTSIDER_ID });
      expect((await clientFor(A_LEADER_ID).participants.list({ surveyId })).canRemove).toBe(true);
      await clientFor(A_LEADER_ID).participants.remove({ surveyId, userId: B_OUTSIDER_ID });

      await owner.participants.add({ surveyId, userId: B_OUTSIDER_ID });
      await clientFor(SUPERADMIN_ID, true).participants.remove({
        surveyId,
        userId: B_OUTSIDER_ID,
      });
      expect(await caps(B_OUTSIDER_ID)).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 대상 자격 — 유형 정합
  // ───────────────────────────────────────────────────────────────────────────

  describe('초대할 수 없는 대상', () => {
    it('게스트 계정은 참여자로 초대할 수 없다', async () => {
      await expect(
        clientFor(A_OWNER_ID).participants.add({ surveyId, userId: GUEST_ID }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('퇴사자는 참여자로 초대할 수 없다', async () => {
      await expect(
        clientFor(A_OWNER_ID).participants.add({ surveyId, userId: DEPARTED_ID }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('소유자는 참여자로 추가할 수 없다 — 이미 전권이라 행만 유령이 된다', async () => {
      await expect(
        clientFor(A_OWNER_ID).participants.add({ surveyId, userId: A_OWNER_ID }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('같은 사람을 두 번 초대하면 CONFLICT', async () => {
      const owner = clientFor(A_OWNER_ID);
      await owner.participants.add({ surveyId, userId: B_OUTSIDER_ID });
      await expect(
        owner.participants.add({ surveyId, userId: B_OUTSIDER_ID }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('없는 참여 행 제외는 NOT_FOUND — 조용한 성공이 아니다', async () => {
      await expect(
        clientFor(A_OWNER_ID).participants.remove({ surveyId, userId: B_OUTSIDER_ID }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 후보 검색 — 팀으로 좁히지 않는다
  // ───────────────────────────────────────────────────────────────────────────

  describe('후보 검색', () => {
    it('타 팀 사람도 후보에 나오고, 게스트·퇴사자·소유자·기존 참여자는 빠진다', async () => {
      await clientFor(A_OWNER_ID).participants.add({ surveyId, userId: A_MEMBER_ID });

      const found = await clientFor(A_OWNER_ID).participants.searchCandidates({
        surveyId,
        // 시드 이메일 접두사로 찾는다 — 이름은 uuid 조각이라 안정적인 검색어가 아니다.
        query: 'participants-',
      });
      const ids = found.map((c) => c.userId);

      expect(ids).toContain(B_OUTSIDER_ID); // 타 팀 — 팀으로 좁히지 않는다
      expect(ids).not.toContain(A_OWNER_ID); // 소유자
      expect(ids).not.toContain(A_MEMBER_ID); // 이미 참여 중
      expect(ids).not.toContain(GUEST_ID); // 비내부
      expect(ids).not.toContain(DEPARTED_ID); // 비활성
    });

    it('타 팀 설문의 후보 검색은 관문에서 막힌다 — 설문 id 하나로 전사 명부가 열리지 않는다', async () => {
      await expect(
        clientFor(B_OUTSIDER_ID).participants.searchCandidates({ surveyId, query: '' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 배치 대기 — 판정 순서가 목록과 어긋나지 않는다
  // ───────────────────────────────────────────────────────────────────────────

  it('배치 대기 설문은 참여자에게도 닫힌다 — 목록에도 안 나온다', async () => {
    await clientFor(A_OWNER_ID).participants.add({ surveyId, userId: B_OUTSIDER_ID });
    // 팀을 잃으면(해산) 배치 대기가 된다 — 판정 코어가 참여자 분기보다 먼저 막는다(ADR-0006).
    await db
      .update(surveysTable)
      .set({ teamId: null, assignmentStatus: 'assignment_pending' })
      .where(eq(surveysTable.id, surveyId));

    expect(await caps(B_OUTSIDER_ID)).toEqual([]);
    // 목록이 판정보다 넓으면 열리지 않는 카드가 그려진다.
    expect(await visibleIds(B_OUTSIDER_ID, TEAM_B)).not.toContain(surveyId);

    await db.delete(participantsTable).where(eq(participantsTable.surveyId, surveyId));
    await db
      .update(surveysTable)
      .set({ teamId: TEAM_A, assignmentStatus: 'assigned' })
      .where(eq(surveysTable.id, surveyId));
  });
});
