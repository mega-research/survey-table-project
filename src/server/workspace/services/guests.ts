import { and, asc, eq, ilike, notExists, or, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { surveyParticipants, surveys, users } from '@/db/schema';
import { escapeLikePattern } from '@/lib/operations/filter-shared';
import { isUniqueViolation } from '@/lib/pg-error';
import {
  DEFAULT_SURVEY_GUEST_TABS,
  normalizeSurveyGuestTabs,
} from '@/shared/contracts/workspace';

import {
  type AddSurveyGuestInput,
  GuestAlreadyGrantedError,
  GuestGrantNotFoundError,
  GuestNotGrantableError,
  ParticipantSurveyNotFoundError,
  type RemoveSurveyGuestInput,
  type SearchGuestCandidatesInput,
  type SearchGuestCandidatesOutput,
  type SetSurveyGuestTabsInput,
  type SurveyGuestItem,
  type WorkspaceActionOutput,
} from '../domain/guests';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 설문의 게스트 부여 목록 (.pen FLOW 4-2 클라이언트 블록).
 *
 * `kind='guest'` 만 본다 — 참여자·실사는 같은 테이블에 살지만 모달의 다른 블록이고 권한도
 * 다르다(참여자 목록이 `kind='member'` 만 보는 것과 짝).
 *
 * 탭은 컬럼 값을 그대로 내보내지 않고 정규화해서 보낸다. NULL·키 누락은 옛 행에서 나오고,
 * 화면이 `?.` 로 덧대기 시작하면 기본값의 정본이 컴포넌트마다 갈린다.
 */
export async function listSurveyGuests(surveyId: string): Promise<SurveyGuestItem[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      organization: users.organization,
      guestTabs: surveyParticipants.guestTabs,
      addedAt: surveyParticipants.createdAt,
    })
    .from(surveyParticipants)
    .innerJoin(users, eq(users.id, surveyParticipants.userId))
    .where(and(eq(surveyParticipants.surveyId, surveyId), eq(surveyParticipants.kind, 'guest')))
    .orderBy(asc(surveyParticipants.createdAt));

  return rows.map(({ guestTabs, ...rest }) => ({
    ...rest,
    tabs: normalizeSurveyGuestTabs(guestTabs),
  }));
}

/**
 * 부여 후보 검색 — **guest active 계정만**.
 *
 * 참여자 검색과 정확히 반대의 모집단이다(저쪽은 internal). 두 검색을 한 함수로 합치지 않은
 * 이유가 그것이다 — 합치면 화면이 결과를 유형으로 다시 걸러야 하고, 거르는 것을 잊으면
 * 「추가는 됐는데 아무것도 안 되는」 행이 생긴다.
 *
 * 이미 부여된 사람은 빠진다. 소유자 제외는 하지 않는다 — 소유자는 언제나 내부 계정이라
 * 이 모집단에 애초에 들어올 수 없다.
 */
export async function searchGuestCandidates(
  input: SearchGuestCandidatesInput,
): Promise<SearchGuestCandidatesOutput> {
  const alreadyGranted = db
    .select({ one: sql`1` })
    .from(surveyParticipants)
    .where(
      and(eq(surveyParticipants.surveyId, input.surveyId), eq(surveyParticipants.userId, users.id)),
    );

  const keyword = escapeLikePattern(input.query);
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      organization: users.organization,
    })
    .from(users)
    .where(
      and(
        eq(users.status, 'active'),
        eq(users.userType, 'guest'),
        notExists(alreadyGranted),
        keyword.length > 0
          ? or(ilike(users.name, `%${keyword}%`), ilike(users.email, `%${keyword}%`))
          : undefined,
      ),
    )
    .orderBy(asc(users.name))
    .limit(20);
}

/**
 * 부여 추가 — 언제나 기본 탭(응답 현황만)으로 선다.
 *
 * 관문(`survey.invite`)은 procedure 가 이미 지났다. 여기가 지는 것은 **대상의 자격**이다.
 *
 * 설문 존재를 트랜잭션 안에서 다시 보는 이유는 참여자 추가와 같다 — 관문의 조회와 이 INSERT
 * 는 별도 왕복이라, 그 사이 설문이 사라지면 FK 위반이 그대로 올라가 rpc-error-policy 가
 * 500 으로 마스킹한다(티켓 15 「거부는 RPC 어휘로」). 참여자와 달리 행을 **잠그지는 않는다**:
 * 저쪽은 잠긴 값(소유자)을 판정에 쓰지만 여기서 필요한 것은 존재뿐이고, 게스트는 소유자가
 * 될 수 없어 이전과 경합할 불변식이 없다.
 *
 * 중복은 UNIQUE 가 최종 판정이다 — 미리 SELECT 로 확인해도 동시 요청 둘 사이의 창은 남는다.
 */
export async function addSurveyGuest(
  actorUserId: string,
  input: AddSurveyGuestInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    const [survey] = await tx
      .select({ id: surveys.id })
      .from(surveys)
      .where(eq(surveys.id, input.surveyId));
    if (!survey) throw new ParticipantSurveyNotFoundError();

    const [target] = await tx
      .select({ status: users.status, userType: users.userType })
      .from(users)
      .where(eq(users.id, input.userId));
    if (!target) throw new GuestNotGrantableError('사용자를 찾을 수 없습니다.');
    if (target.userType !== 'guest' || target.status !== 'active') {
      throw new GuestNotGrantableError();
    }

    try {
      await tx.insert(surveyParticipants).values({
        surveyId: input.surveyId,
        userId: input.userId,
        kind: 'guest',
        // 공유 상수를 그대로 넘기지 않는다 — 드라이버가 값을 만지면 전역 기본값이 변한다.
        guestTabs: { ...DEFAULT_SURVEY_GUEST_TABS },
        addedBy: actorUserId,
      });
    } catch (error) {
      // UNIQUE 는 (surveyId, userId) 라 kind 를 가리지 않는다 — 같은 사람이 참여자로 이미
      // 서 있어도 여기로 온다. 문구를 「이미 부여됨」으로 두는 것이 맞다: 어느 자격이든
      // 그 설문에 이미 서 있다는 뜻이고, 두 자격을 겸할 수 없다는 것이 0109 의 계약이다.
      if (isUniqueViolation(error)) throw new GuestAlreadyGrantedError();
      throw error;
    }
    return OK;
  });
}

/**
 * 탭 화이트리스트 저장 — 네 값을 통째로 덮어쓴다.
 *
 * `kind='guest'` 를 WHERE 에 함께 거는 것이 중요하다. 이 표면은 클라이언트 블록의 것이고,
 * 조건이 없으면 게스트 탭 저장이 참여자·실사 행의 `guest_tabs` 컬럼을 건드린다 — 지금은
 * 읽는 쪽이 없어 조용하지만, 실사가 자기 축을 얻는 순간(티켓 24) 남의 부여를 덮게 된다.
 */
export async function setSurveyGuestTabs(
  input: SetSurveyGuestTabsInput,
): Promise<WorkspaceActionOutput> {
  const updated = await db
    .update(surveyParticipants)
    .set({ guestTabs: input.tabs })
    .where(
      and(
        eq(surveyParticipants.surveyId, input.surveyId),
        eq(surveyParticipants.userId, input.userId),
        eq(surveyParticipants.kind, 'guest'),
      ),
    )
    .returning({ id: surveyParticipants.id });
  if (updated.length === 0) throw new GuestGrantNotFoundError();
  return OK;
}

/**
 * 부여 해제.
 *
 * 관문(`survey.manageAccess`)이 주체를 소유자·소유 팀 팀장·슈퍼어드민으로 좁혔다. 여기가
 * 지는 것은 **대상이 게스트 부여 행으로 존재하는가** 뿐이다. `kind='guest'` 조건이 없으면
 * 이 버튼이 참여자 초대까지 지운다(참여자 제외 표면의 대칭).
 */
export async function removeSurveyGuest(
  input: RemoveSurveyGuestInput,
): Promise<WorkspaceActionOutput> {
  const removed = await db
    .delete(surveyParticipants)
    .where(
      and(
        eq(surveyParticipants.surveyId, input.surveyId),
        eq(surveyParticipants.userId, input.userId),
        eq(surveyParticipants.kind, 'guest'),
      ),
    )
    .returning({ id: surveyParticipants.id });
  if (removed.length === 0) throw new GuestGrantNotFoundError();
  return OK;
}
