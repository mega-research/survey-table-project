import { and, asc, eq, getTableName, ilike, notExists, or, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyParticipants, surveys, users } from '@/db/schema';
import { escapeLikePattern } from '@/lib/operations/filter-shared';
import { isUniqueViolation } from '@/lib/pg-error';
import {
  loadSurveyCapabilities,
  participantAccessLevelFor,
  type SurveyAccessUser,
} from '@/server/survey-access';

import {
  type AddSurveyParticipantInput,
  OwnerCannotBeParticipantError,
  ParticipantAlreadyExistsError,
  ParticipantNotFoundError,
  ParticipantNotInvitableError,
  ParticipantSurveyNotFoundError,
  type RemoveSurveyParticipantInput,
  type SearchParticipantCandidatesInput,
  type SearchParticipantCandidatesOutput,
  type SurveyParticipantItem,
  type WorkspaceActionOutput,
} from '../domain/participants';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 이 사람의 **활성** 소속 팀 이름 — 참여자 행·후보 행의 소속 표기.
 *
 * 목록·검색이 함께 쓰는 상관 서브쿼리다. 조인으로 붙이면 겸직인 사람이 행을 두 번 만들고,
 * 화면은 같은 이름이 두 줄 뜨는 것을 참여가 둘인 것으로 읽는다. 겸직은 드물고 여기서
 * 필요한 것은 「어디 사람인가」 한 줄이라 첫 팀만 고른다.
 *
 * 바깥 컬럼을 `${users.id}` 로 끼워 넣지 **못한다**. drizzle 0.45.2 는 그 참조를 FROM 이
 * `users` 하나뿐일 때 테이블 접두사 없이(`"id"`) 펴는데, 상관 서브쿼리 안에는 `users` 가
 * 없어 Postgres 가 해석하지 못한다(실측: `.from(users)` → `"id"`, 조인이 있으면
 * `"users"."id"`). 두 소비자가 그 두 모양을 하나씩 쓰므로 한쪽은 반드시 깨진다.
 *
 * 그래서 참조를 **스키마에서 뽑아** 언제나 정규화된 형태로 만든다 — 이름을 손으로 적으면
 * 테이블·컬럼 개명이 tsc 에도 db:drift 에도 안 잡힌다.
 */
const usersIdRef = sql`${sql.identifier(getTableName(users))}.${sql.identifier(users.id.name)}`;

const activeTeamName = sql<string | null>`(
  select t.name from team_members tm
  join teams t on t.id = tm.team_id
  where tm.user_id = ${usersIdRef} and t.status = 'active'
  order by t."order", t.name
  limit 1
)`;

/**
 * 설문의 참여자 목록 (.pen FLOW 4-2 참여자 블록).
 *
 * `kind='member'` 만 본다 — 게스트·실사는 같은 테이블에 살지만 모달의 다른 블록이고
 * (티켓 21·24) 권한도 다르다. 한 목록으로 합치면 화면이 kind 로 다시 갈라야 한다.
 */
export async function listSurveyParticipants(surveyId: string): Promise<SurveyParticipantItem[]> {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      kind: surveyParticipants.kind,
      accessLevel: surveyParticipants.accessLevel,
      teamName: activeTeamName,
      addedAt: surveyParticipants.createdAt,
    })
    .from(surveyParticipants)
    .innerJoin(users, eq(users.id, surveyParticipants.userId))
    .where(and(eq(surveyParticipants.surveyId, surveyId), eq(surveyParticipants.kind, 'member')))
    .orderBy(asc(surveyParticipants.createdAt));
}

/**
 * 초대 후보 검색 — **팀으로 좁히지 않는다**.
 *
 * 참여자는 팀 경계를 넘고 팀 멤버십을 만들지 않는다(스펙 §4). 팀원 추가(pull 모델)가
 * 「미배치 사용자만」으로 좁히는 것과 정반대의 모집단이라, 두 검색을 한 함수로 합치지 않았다.
 *
 * 빠지는 사람 셋: 비활성·비내부 계정(초대해도 아무것도 못 한다), 이미 참여 중인 사람,
 * 그리고 **소유자**. 목록에 있는 사람을 다시 고르는 동선은 실패밖에 없다.
 */
export async function searchParticipantCandidates(
  input: SearchParticipantCandidatesInput,
): Promise<SearchParticipantCandidatesOutput> {
  const alreadyParticipant = db
    .select({ one: sql`1` })
    .from(surveyParticipants)
    .where(
      and(eq(surveyParticipants.surveyId, input.surveyId), eq(surveyParticipants.userId, users.id)),
    );

  const isOwner = db
    .select({ one: sql`1` })
    .from(surveys)
    .where(and(eq(surveys.id, input.surveyId), eq(surveys.ownerUserId, users.id)));

  const keyword = escapeLikePattern(input.query);
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      teamName: activeTeamName,
    })
    .from(users)
    .where(
      and(
        eq(users.status, 'active'),
        eq(users.userType, 'internal'),
        notExists(alreadyParticipant),
        notExists(isOwner),
        keyword.length > 0
          ? or(ilike(users.name, `%${keyword}%`), ilike(users.email, `%${keyword}%`))
          : undefined,
      ),
    )
    .orderBy(asc(users.name))
    .limit(20);
}

/**
 * 참여자 추가 — 초대.
 *
 * 관문(`survey.invite`)은 procedure 가 이미 지났다. 여기가 지는 것은 **대상의 자격**과
 * **권한 등급**이다 — 초대받은 사람이 초대한 사람보다 넓어지지 않는다(0123).
 *
 * 설문 행을 트랜잭션 안에서 잠그고 소유자를 다시 읽는 이유는, 관문의 조회와 이 INSERT 가
 * 별도 왕복이라 그 사이 소유권이 이전될 수 있어서다(티켓 19). 잠그지 않으면 새 소유자가
 * 참여자로도 서는 행이 만들어진다.
 *
 * 중복은 UNIQUE 가 최종 판정이다 — 미리 SELECT 로 확인해도 동시 요청 둘 사이의 창은 남는다.
 */
export async function addSurveyParticipant(
  actor: SurveyAccessUser,
  input: AddSurveyParticipantInput,
): Promise<WorkspaceActionOutput> {
  // 등급은 초대자의 권한이 정한다(0123) — 참여자 열 전부를 가진 초대자만 full 을 만든다.
  // 관문(survey.invite)은 procedure 가 지났지만 서비스를 직접 부르는 경로도 같은 규칙을 지도록
  // 여기서 판정한다. 팀원이 자기 자신·동료를 초대해 응답 원문을 얻던 우회가 이 한 줄에 걸려 있다.
  const accessLevel = participantAccessLevelFor(await loadSurveyCapabilities(actor, input.surveyId));

  return db.transaction(async (tx) => {
    const [survey] = await tx
      .select({ ownerUserId: surveys.ownerUserId })
      .from(surveys)
      .where(eq(surveys.id, input.surveyId))
      .for('update');
    // 관문을 지난 뒤 사라진 설문 — 그냥 내려가면 INSERT 가 FK 위반으로 터져
    // rpc-error-policy 가 500 으로 마스킹한다(티켓 15 「거부는 RPC 어휘로」).
    if (!survey) throw new ParticipantSurveyNotFoundError();
    if (survey.ownerUserId === input.userId) throw new OwnerCannotBeParticipantError();

    const [target] = await tx
      .select({ status: users.status, userType: users.userType })
      .from(users)
      .where(eq(users.id, input.userId));
    if (!target) throw new ParticipantNotInvitableError('사용자를 찾을 수 없습니다.');
    if (target.userType !== 'internal' || target.status !== 'active') {
      throw new ParticipantNotInvitableError();
    }

    try {
      await tx.insert(surveyParticipants).values({
        surveyId: input.surveyId,
        userId: input.userId,
        kind: 'member',
        accessLevel,
        addedBy: actor.id,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ParticipantAlreadyExistsError();
      throw error;
    }
    return OK;
  });
}

/**
 * 참여자 제외.
 *
 * 관문(`survey.manageAccess`)이 주체를 이미 소유자·팀장·슈퍼어드민으로 좁혔다. 여기가 지는
 * 것은 **대상이 참여 행으로 존재하는가** 뿐이다 — 0행을 조용히 성공으로 접으면 화면은
 * 제외했다고 말하고 목록에는 그대로 남는다(그 사이 다른 사람이 먼저 뺀 경우).
 *
 * `kind='member'` 를 조건에 함께 거는 것이 중요하다. 이 표면은 참여자 블록의 것이고,
 * 게스트·실사 부여 해제는 각자의 표면이 진다(티켓 21·24) — 조건이 없으면 참여자 제외
 * 버튼이 게스트 부여까지 지운다.
 */
export async function removeSurveyParticipant(
  input: RemoveSurveyParticipantInput,
): Promise<WorkspaceActionOutput> {
  const removed = await db
    .delete(surveyParticipants)
    .where(
      and(
        eq(surveyParticipants.surveyId, input.surveyId),
        eq(surveyParticipants.userId, input.userId),
        eq(surveyParticipants.kind, 'member'),
      ),
    )
    .returning({ id: surveyParticipants.id });
  if (removed.length === 0) throw new ParticipantNotFoundError();
  return OK;
}
