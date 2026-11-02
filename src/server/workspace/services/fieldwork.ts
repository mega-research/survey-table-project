import { and, asc, eq, ilike, notExists, or, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { fieldworkOrgs, surveyParticipants, surveys, users } from '@/db/schema';
import { escapeLikePattern } from '@/lib/operations/filter-shared';
import { isUniqueViolation } from '@/lib/pg-error';
import type { FieldworkRole } from '@/shared/contracts/auth';

import {
  type AddSurveyFieldworkInput,
  FieldworkAlreadyInvitedError,
  FieldworkInviteNotFoundError,
  FieldworkNotInvitableError,
  ParticipantSurveyNotFoundError,
  type RemoveSurveyFieldworkInput,
  type SearchFieldworkCandidatesInput,
  type SearchFieldworkCandidatesOutput,
  type SurveyFieldworkItem,
  type WorkspaceActionOutput,
} from '../domain/fieldwork';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 역할 없는 행을 조용히 뺀다.
 *
 * `users.fieldwork_role` 은 0120 CHECK 가 보장하지만 타입은 nullable 이다 — 제약이 보장하는
 * 것을 코드가 다시 주장하지 않고(`!` 나 기본값을 넣지 않고) 그냥 건너뛴다. 목록과 후보
 * 검색이 같은 규칙을 봐야 해서 한 자리에 둔다.
 */
function withRole<T extends { fieldworkRole: FieldworkRole | null }>(
  rows: readonly T[],
): (Omit<T, 'fieldworkRole'> & { fieldworkRole: FieldworkRole })[] {
  return rows.flatMap(({ fieldworkRole, ...rest }) =>
    fieldworkRole ? [{ ...rest, fieldworkRole }] : [],
  );
}

/**
 * 설문의 실사 초대 목록 (.pen FLOW 4-2 실사 블록).
 *
 * `kind='fieldwork'` 만 본다 — 참여자·게스트는 같은 테이블에 살지만 모달의 다른 블록이고
 * 권한도 다르다(게스트 목록이 `kind='guest'` 만 보는 것과 짝).
 *
 * 업체는 **inner join** 이다. 소속이 없는 실사 계정은 존재할 수 없고(0120 CHECK), 종료된
 * 업체 소속이라도 이름은 그대로 보여야 한다 — 「이 사람은 어느 업체였는가」가 목록에서
 * 사라지면 해제 판단을 할 수 없다. 그래서 status 로 좁히지 않는다.
 */
export async function listSurveyFieldwork(surveyId: string): Promise<SurveyFieldworkItem[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      orgName: fieldworkOrgs.name,
      fieldworkRole: users.fieldworkRole,
      addedAt: surveyParticipants.createdAt,
    })
    .from(surveyParticipants)
    .innerJoin(users, eq(users.id, surveyParticipants.userId))
    .innerJoin(fieldworkOrgs, eq(fieldworkOrgs.id, users.fieldworkOrgId))
    .where(
      and(eq(surveyParticipants.surveyId, surveyId), eq(surveyParticipants.kind, 'fieldwork')),
    )
    .orderBy(asc(surveyParticipants.createdAt));

  return withRole(rows);
}

/**
 * 초대 후보 검색 — **활성 업체 소속의 fieldwork active 계정만** (.pen 「업체명으로 구분」).
 *
 * 업체를 `status='active'` 로 좁히는 것이 목록(listSurveyFieldwork)과 갈리는 지점이다.
 * 저쪽은 이미 선 초대를 보여주는 자리라 종료된 업체도 이름을 남겨야 하지만, 여기는 **새로
 * 들이는** 자리라 종료된 업체 사람을 후보로 세우면 초대한 순간 아무것도 못 하는 행이 된다
 * (판정 코어가 활성 업체일 때만 소속을 채운다).
 *
 * 검색어는 이름·이메일에 더해 **업체명**도 본다 — 같은 이름의 실사원이 업체마다 있을 수 있고,
 * 화면이 업체로 구분하라고 말하므로 그 축으로 찾을 수 있어야 한다.
 *
 * 이미 초대된 사람은 빠진다(kind 를 가리지 않는다 — 어느 자격이든 그 설문에 서 있으면
 * 두 번째 자격을 겸할 수 없다는 것이 0119 의 계약이다).
 */
export async function searchFieldworkCandidates(
  input: SearchFieldworkCandidatesInput,
): Promise<SearchFieldworkCandidatesOutput> {
  const alreadyInvited = db
    .select({ one: sql`1` })
    .from(surveyParticipants)
    .where(
      and(eq(surveyParticipants.surveyId, input.surveyId), eq(surveyParticipants.userId, users.id)),
    );

  const keyword = escapeLikePattern(input.query);
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      orgName: fieldworkOrgs.name,
      fieldworkRole: users.fieldworkRole,
    })
    .from(users)
    .innerJoin(fieldworkOrgs, eq(fieldworkOrgs.id, users.fieldworkOrgId))
    .where(
      and(
        eq(users.status, 'active'),
        eq(users.userType, 'fieldwork'),
        eq(fieldworkOrgs.status, 'active'),
        notExists(alreadyInvited),
        keyword.length > 0
          ? or(
              ilike(users.name, `%${keyword}%`),
              ilike(users.email, `%${keyword}%`),
              ilike(fieldworkOrgs.name, `%${keyword}%`),
            )
          : undefined,
      ),
    )
    // 업체로 묶어 보여준다 — 화면이 업체명으로 사람을 구분하는 자리다.
    .orderBy(asc(fieldworkOrgs.name), asc(users.name))
    .limit(20);

  return withRole(rows);
}

/**
 * 초대 추가.
 *
 * 관문(`survey.invite`)은 procedure 가 이미 지났다. 여기가 지는 것은 **대상의 자격**이다 —
 * 활성 업체 소속의 활성 실사 계정. 업체 조건이 게스트 추가와 갈리는 유일한 지점이다.
 *
 * 설문 존재를 트랜잭션 안에서 다시 보는 이유는 게스트 추가와 같다 — 관문의 조회와 이 INSERT
 * 는 별도 왕복이라, 그 사이 설문이 사라지면 FK 위반이 그대로 올라가 rpc-error-policy 가
 * 500 으로 마스킹한다(티켓 15 「거부는 RPC 어휘로」).
 *
 * 중복은 UNIQUE 가 최종 판정이다 — 미리 SELECT 로 확인해도 동시 요청 둘 사이의 창은 남는다.
 */
export async function addSurveyFieldwork(
  actorUserId: string,
  input: AddSurveyFieldworkInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    const [survey] = await tx
      .select({ id: surveys.id })
      .from(surveys)
      .where(eq(surveys.id, input.surveyId));
    if (!survey) throw new ParticipantSurveyNotFoundError();

    const [target] = await tx
      .select({
        status: users.status,
        userType: users.userType,
        orgStatus: fieldworkOrgs.status,
      })
      .from(users)
      .leftJoin(fieldworkOrgs, eq(fieldworkOrgs.id, users.fieldworkOrgId))
      .where(eq(users.id, input.userId));
    if (!target) throw new FieldworkNotInvitableError('사용자를 찾을 수 없습니다.');
    if (target.userType !== 'fieldwork' || target.status !== 'active') {
      throw new FieldworkNotInvitableError();
    }
    if (target.orgStatus !== 'active') {
      throw new FieldworkNotInvitableError('종료된 업체 소속 계정은 초대할 수 없습니다.');
    }

    try {
      await tx.insert(surveyParticipants).values({
        surveyId: input.surveyId,
        userId: input.userId,
        kind: 'fieldwork',
        // 탭 축은 게스트 전용이다 — 실사에는 화이트리스트가 없고 열리는 화면이 고정이다.
        addedBy: actorUserId,
      });
    } catch (error) {
      // UNIQUE 는 (surveyId, userId) 라 kind 를 가리지 않는다 — 같은 사람이 참여자·게스트로
      // 이미 서 있어도 여기로 온다. 두 자격을 겸할 수 없다는 것이 0119 의 계약이다.
      if (isUniqueViolation(error)) throw new FieldworkAlreadyInvitedError();
      throw error;
    }
    return OK;
  });
}

/**
 * 초대 해제.
 *
 * 관문(`survey.manageAccess`)이 주체를 소유자·소유 팀 팀장·슈퍼어드민으로 좁혔다. 여기가
 * 지는 것은 **대상이 실사 초대 행으로 존재하는가** 뿐이다. `kind='fieldwork'` 조건이 없으면
 * 이 버튼이 참여자·게스트 부여까지 지운다(다른 두 블록 제외 표면의 대칭).
 *
 * **팀장의 파생 시야는 여기서 지워지지 않는다** — 그것은 행이 아니라 소속원 초대의 함수라,
 * 마지막 소속원의 초대를 해제하는 순간 자동으로 닫힌다.
 */
export async function removeSurveyFieldwork(
  input: RemoveSurveyFieldworkInput,
): Promise<WorkspaceActionOutput> {
  const removed = await db
    .delete(surveyParticipants)
    .where(
      and(
        eq(surveyParticipants.surveyId, input.surveyId),
        eq(surveyParticipants.userId, input.userId),
        eq(surveyParticipants.kind, 'fieldwork'),
      ),
    )
    .returning({ id: surveyParticipants.id });
  if (removed.length === 0) throw new FieldworkInviteNotFoundError();
  return OK;
}
