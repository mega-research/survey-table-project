import { cache } from 'react';

import {
  type SQL,
  and,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import 'server-only';

import { db } from '@/db';
import {
  questionGroups,
  questions,
  surveyGroups,
  surveyParticipants,
  surveys,
  teamMembers,
  teams,
  users,
} from '@/db/schema';
import { retentionTimestampToDate } from '@/lib/survey/pii-retention';
import { normalizeResponseHeaderConfig } from '@/lib/survey/response-header-config';
import type { SurveyScopeFilter } from '@/server/work-scope';
import { isCodedChoiceType } from '@/types/question-types';
import type {
  InputType,
  QuestionGroup,
  Question as QuestionType,
  Survey as SurveyType,
} from '@/types/survey';
import { generateAllOptionCodes } from '@/utils/option-code-generator';
import { generateAllCellCodes } from '@/utils/table-cell-code-generator';

// ========================
// 설문 조회 함수
// ========================

// 무범위 목록(구 getSurveys)은 제거됐다(티켓 09) — 마지막 소비자였던 분석 대시보드가
// 작업 범위 목록(getSurveyListWithCounts)으로 옮겨 갔다. 목록은 항상 범위를 지나야 한다.

/**
 * 「내가 이 설문의 참여자로서 실제로 접근하는가」 — 목록 **조건**과 **투영**이 함께 쓰는 조각.
 *
 * 하나로 두는 것이 중요하다. 처음에는 조건과 투영을 따로 썼는데 그 순간 갈렸다 — 투영 쪽에만
 * 배치 대기 조건이 빠져, 슈퍼어드민의 시스템 전체 보기에서 배치 대기 설문의 `isParticipant`
 * 가 true 로 나왔다(리뷰에서 잡힘). 같은 사실은 한 자리에서만 말한다.
 *
 * 배치 대기를 빼는 것이 그 사실의 일부다. 판정 코어가 `assignment_pending` 을 참여자
 * 분기보다 **먼저** 차단하므로(팀이 정해지기 전에는 아무도 못 연다, ADR-0006), 목록·투영이
 * 그것보다 넓으면 열리지 않는 카드가 그려지고 버튼도 열린 것처럼 보인다.
 */
/**
 * 「내 팀원이 이 설문에 초대돼 있는가」 — 초대의 **팀장 전파**가 목록에 붙는 조건.
 *
 * 판정 코어의 전파 분기(`participantTeamLed`)와 **같은 사실**을 SQL 로 말한다. 조건 셋도
 * 그쪽과 같다 — `kind='member'` · 팀원 `status='active'` · 소속 팀 `status='active'`.
 * 하나라도 어긋나면 목록과 판정이 갈려 「열리지 않는 카드」나 「보이지 않는데 열리는 설문」이
 * 생긴다.
 *
 * 배치 대기를 함께 빼는 것도 participatesInSurvey 와 같은 이유다 — 코어가 그것을 전파보다
 * 먼저 막으므로, 목록만 넓히면 열리지 않는 카드가 그려진다.
 */
export function leadsParticipantTeam(leaderTeamIds: readonly string[]): SQL {
  const invite = alias(surveyParticipants, 'led_invite');
  const teammate = alias(users, 'led_invitee');
  const membership = alias(teamMembers, 'led_membership');
  const team = alias(teams, 'led_team');
  return and(
    eq(surveys.assignmentStatus, 'assigned'),
    exists(
      db
        .select({ one: sql`1` })
        .from(invite)
        .innerJoin(teammate, eq(teammate.id, invite.userId))
        .innerJoin(membership, eq(membership.userId, invite.userId))
        .innerJoin(team, and(eq(team.id, membership.teamId), eq(team.status, 'active')))
        .where(
          and(
            eq(invite.surveyId, surveys.id),
            eq(invite.kind, 'member'),
            eq(teammate.status, 'active'),
            inArray(membership.teamId, [...leaderTeamIds]),
          ),
        ),
    ),
  )!;
}

export function participatesInSurvey(viewerId: string, options: { fullOnly?: boolean } = {}): SQL {
  return and(
    eq(surveys.assignmentStatus, 'assigned'),
    exists(
      db
        .select({ one: sql`1` })
        .from(surveyParticipants)
        .where(
          and(
            eq(surveyParticipants.surveyId, surveys.id),
            eq(surveyParticipants.userId, viewerId),
            eq(surveyParticipants.kind, 'member'),
            // 등급(0123)은 투영에만 쓴다 — 목록 조건은 등급과 무관하게 참여 사실만 본다.
            options.fullOnly ? eq(surveyParticipants.accessLevel, 'full') : undefined,
          ),
        ),
    ),
  )!;
}

/**
 * 목록 두 벌이 함께 쓰는 투영 (티켓 17).
 *
 * `getScopedSurveys`(보이는 설문)와 `getDeletedSurveys`(휴지통)는 조회 조건만 다르고 화면은
 * 같은 카드를 그린다. 컬럼을 각자 적으면 한쪽에 필드가 늘 때 다른 쪽이 조용히 옛 모양으로
 * 남고, 그 순간 `SurveyListItem` 조립이 두 갈래가 된다.
 *
 * `deletedAt` 이 양쪽에 있는 것은 의도다. 범위 목록에서는 조건이 `IS NULL` 이라 언제나
 * null 이지만, 그 덕에 화면이 값 하나로 「휴지통을 보고 있는가」를 판정한다 — 모드를 별도
 * 플래그로 내려보내면 목록과 모드가 어긋나는 상태가 표현 가능해진다.
 *
 * 그룹 열은 두 목록이 서로 다른 규칙을 쓰므로 각자 붙인다.
 *
 * 상수가 아니라 **함수**인 것은 평가 시점 때문이다. 모듈 최상위에서 `teams.name` 을 읽으면
 * import 시점에 스키마가 필요해져, `@/db/schema` 를 부분 모킹하는 테스트가 이 모듈을
 * 체인에 들이는 순간 「No "teams" export」로 깨진다. 쿼리를 만들 때 부르면 종전과 같다.
 */
function surveyListColumns(viewerId: string | null) {
  return {
    /**
     * 내가 이 설문의 참여자인가 (티켓 18) — 카드의 버튼 노출 근사가 본다.
     *
     * 참여자는 `responses.view` 를 갖지만 팀원은 못 갖는다. 이 값이 없으면 카드가 둘을
     * 구별할 수 없어 초대받은 사람에게 「분석」이 잠긴 채로 보인다(티켓 16 주석의 예고).
     * 목록 조건과 **같은 술어**를 쓴다 — 따로 쓰면 갈린다(participatesInSurvey 주석).
     * 휴지통 목록은 viewerId 를 주지 않는다 — 복구 말고 할 수 있는 일이 없다.
     */
    isParticipant:
      viewerId === null ? sql<boolean>`false` : participatesInSurvey(viewerId).mapWith(Boolean),
    /** 그 참여가 full 등급인가 (0123) — 제한 참여자에게 「분석」이 잠긴 채 열리지 않게 한다. */
    isFullParticipant:
      viewerId === null
        ? sql<boolean>`false`
        : participatesInSurvey(viewerId, { fullOnly: true }).mapWith(Boolean),
    id: surveys.id,
    title: surveys.title,
    description: surveys.description,
    slug: surveys.slug,
    privateToken: surveys.privateToken,
    createdAt: surveys.createdAt,
    updatedAt: surveys.updatedAt,
    endDate: surveys.endDate,
    isPublic: surveys.isPublic,
    status: surveys.status,
    teamId: surveys.teamId,
    teamName: teams.name,
    visibility: surveys.visibility,
    assignmentStatus: surveys.assignmentStatus,
    ownerUserId: surveys.ownerUserId,
    ownerName: users.name,
    deletedAt: surveys.deletedAt,
  } as const;
}

/**
 * 작업 범위로 좁힌 설문 목록 (역할 모델 v2 티켓 07).
 *
 * 판정은 하지 않는다 — 무엇을 보게 되는지는 이미 buildSurveyScopeFilter 가 정했고 여기는
 * 그 조건을 SQL 로 옮길 뿐이다. 이 함수가 "팀장인가" 를 다시 물으면 매트릭스가 두 벌이 된다.
 *
 * 팀 범위에서 배치 대기 설문을 빼는 것은 조건이 아니라 정의다 — 배치 대기는 team_id 가
 * NULL 이라 어느 팀 범위에도 걸리지 않는다. 시스템 범위만 그것을 본다.
 */
export async function getScopedSurveys(filter: SurveyScopeFilter) {
  if (filter.kind === 'none') return [];

  const conditions: SQL[] = [isNull(surveys.deletedAt)];
  if (filter.kind === 'team') {
    // 팀 범위가 보는 것 = 그 팀 설문 + **내가 초대받은 설문**(팀 무관, 티켓 18).
    // 초대는 팀 축 밖의 접근이라 팀 조건을 좁히는 대신 OR 로 잇는다.
    //
    // **겸직자에게는 초대 설문이 모든 팀 범위에 똑같이 나타난다 — 의도한 동작이다.**
    // 그 설문은 어느 팀에도 속하지 않아 「이 초대는 A팀 화면의 것」이라고 말할 근거가 없다.
    // 한쪽 범위에만 붙이면 규칙을 임의로 정하는 셈이고, 다른 팀으로 스위처를 돌린 사람은
    // 초대받은 설문이 사라진 것으로 읽는다. 카드가 소유 팀을 함께 적으므로(`… 소유`)
    // 어디 것인지는 화면에서 구별된다.
    const inTeam = filter.seesInviteOnly
      ? eq(surveys.teamId, filter.teamId)
      : // invite_only 는 소유 팀 팀원에게만 숨긴다 — 자기가 소유한 설문은 남는다(스펙 §3).
        and(
          eq(surveys.teamId, filter.teamId),
          or(eq(surveys.visibility, 'team'), eq(surveys.ownerUserId, filter.viewerId)),
        )!;

    // 내 팀원이 초대된 설문도 팀장에게 보인다 — 코어의 전파 분기와 같은 사실이다.
    // 팀장이 아니면 조건을 세우지 않는다(빈 IN 은 언제나 거짓이라 무해하지만, 없는 축의
    // 서브쿼리를 실행 계획에 들이지 않는 편이 낫다).
    const visible =
      filter.leaderTeamIds.length > 0
        ? or(
            inTeam,
            participatesInSurvey(filter.viewerId),
            leadsParticipantTeam(filter.leaderTeamIds),
          )!
        : or(inTeam, participatesInSurvey(filter.viewerId))!;
    conditions.push(visible);
  }

  return db
    .select({
      ...surveyListColumns(filter.viewerId),
      // 그룹은 팀 소유물이라 팀이 다른 그룹 id 가 남아 있으면 그건 깨진 상태다(팀을 옮기는
      // 흐름이 surveyGroupId 를 안 내린 경우). 목록에서는 미분류로 보여 그 상태를 정상처럼
      // 그리지 않는다 — 그룹 화면 필터도 이 값을 보므로 유령 그룹에 갇히지 않는다.
      //
      // **초대받은 타 팀 설문도 여기서 미분류로 접힌다**(티켓 18). 그 설문은 소유 팀의 그룹에
      // 담겨 있지만 그 그룹은 보는 사람의 사이드바에 없다 — id 를 그대로 실어 보내면 어느
      // 화면에서도 열 수 없는 폴더를 가리키게 된다.
      surveyGroupId: visibleGroupId(filter),
    })
    .from(surveys)
    .leftJoin(teams, eq(teams.id, surveys.teamId))
    .leftJoin(users, eq(users.id, surveys.ownerUserId))
    .leftJoin(surveyGroups, eq(surveyGroups.id, surveys.surveyGroupId))
    .where(and(...conditions))
    .orderBy(desc(surveys.createdAt));
}

/**
 * 화면이 열 수 있는 그룹 id 만 남긴다.
 *
 * 두 가지를 접는다 — 깨진 상태(설문 팀 ≠ 그룹 팀)와 **보는 범위 밖의 그룹**. 뒤의 것이
 * 티켓 18 이 더한 축이다: 초대받은 타 팀 설문은 소유 팀 그룹에 담겨 있고 그 그룹은 이
 * 사람의 사이드바에 없다. 시스템 전체 보기에는 그룹 개념이 없으므로 좁힐 범위도 없다.
 */
function visibleGroupId(filter: SurveyScopeFilter): SQL<string | null> {
  const sameTeam = sql`${surveys.teamId} is not distinct from ${surveyGroups.teamId}`;
  const inScope = filter.kind === 'team' ? sql`${surveys.teamId} = ${filter.teamId}` : sql`true`;
  return sql<
    string | null
  >`case when ${sameTeam} and ${inScope} then ${surveys.surveyGroupId} else null end`;
}

/**
 * 삭제된 설문 전수 (역할 모델 v2 티켓 17) — **슈퍼어드민의 시스템 전체 보기 전용**.
 *
 * `getScopedSurveys` 의 반대편이다. 저쪽은 "이 범위에서 무엇이 보이는가" 라 팀·공개 범위
 * 조건이 붙지만, 이쪽은 **팀 경계로 좁힐 수 없는 목록**이다 — 삭제된 설문은 어느 팀 화면에도
 * 속하지 않고 해산된 팀의 것일 수도 있다(재배치 인박스가 슈퍼어드민 전용인 것과 같은 이유).
 * 호출자가 권한을 이미 판정했다는 전제로 조건 없이 전부 준다.
 *
 * 투영을 `getScopedSurveys` 와 맞추는 것은 화면이 같은 카드를 그리기 때문이다 — 모양이
 * 갈리면 복구 목록만 다른 컴포넌트를 요구하게 된다. 그룹 id 는 항상 null 로 접는다:
 * 삭제된 설문에 폴더를 보여줘도 그 폴더 화면에서는 보이지 않아 갈 곳 없는 링크가 된다.
 */
export async function getDeletedSurveys() {
  return db
    .select({
      ...surveyListColumns(null),
      // 삭제된 설문에 폴더를 보여줘도 그 폴더 화면에서는 안 보여 갈 곳 없는 링크가 된다.
      surveyGroupId: sql<string | null>`null::uuid`,
    })
    .from(surveys)
    .leftJoin(teams, eq(teams.id, surveys.teamId))
    .leftJoin(users, eq(users.id, surveys.ownerUserId))
    .where(isNotNull(surveys.deletedAt))
    .orderBy(desc(surveys.deletedAt));
}

/** 삭제된 설문 건수 — 목록 툴바의 「삭제됨 N」 칩. 목록과 같은 조건을 본다. */
export async function countDeletedSurveys(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(surveys)
    .where(isNotNull(surveys.deletedAt));
  return row?.value ?? 0;
}

// 설문 단일 조회. React `cache()` 로 동일 RSC pass 내 중복 호출을 dedupe
// (예: layout 과 page 가 같은 surveyId 를 동시에 조회해도 DB 한 번).
//
// **삭제된 설문은 없는 것으로 본다**(티켓 17). 이 함수가 빌더 상세·운영 콘솔 RSC·미리보기·
// 응답 페이지 조회(getSurveyForResponse)·변수 카탈로그·복제의 공통 입구라, 여기 한 줄이
// 그 경로 전부를 한꺼번에 닫는다. 삭제된 행을 일부러 읽어야 하는 곳(복구 목록·복구 실행)은
// 자기 쿼리를 따로 쓴다 — 이 함수에 플래그를 다는 순간 "기본값이 무엇인가" 가 호출부마다
// 갈리고, React cache 키가 인자별로 갈려 dedupe 도 함께 깨진다.
export const getSurveyById = cache(async (surveyId: string) => {
  const survey = await db.query.surveys.findFirst({
    where: and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)),
  });
  return survey;
});

// ========================
// 질문 그룹 조회 함수
// ========================

// 설문의 질문 그룹 조회
export async function getQuestionGroupsBySurvey(surveyId: string) {
  const groups = await db.query.questionGroups.findMany({
    where: eq(questionGroups.surveyId, surveyId),
    orderBy: [questionGroups.order],
  });
  return groups;
}

// ========================
// 질문 조회 함수
// ========================

// 설문의 질문 조회
export async function getQuestionsBySurvey(surveyId: string) {
  const result = await db.query.questions.findMany({
    where: eq(questions.surveyId, surveyId),
    orderBy: [questions.order],
  });
  return result;
}

// ========================
// 복합 조회 함수
// ========================

// 전체 설문 데이터 조회 (설문 + 그룹 + 질문)
type QuestionRow = typeof questions.$inferSelect;

/**
 * DB 행 → 클라이언트 Question 변환 — 발행 스냅샷·빌더 로드가 공유하는 유일한 읽기 매퍼.
 * 신규 영속 컬럼은 여기 명시 등재가 필요하며, 누락은 곁의 map-question-row.test.ts
 * 가 PERSISTED_QUESTION_FIELDS 전수 대조로 잡는다 (쓰기 채널 SSOT 의 읽기 방향 거울).
 */
export function mapQuestionRow(q: QuestionRow): QuestionType {
  const mapped: QuestionType = {
    id: q.id,
    type: q.type as QuestionType['type'],
    title: q.title,
    ...(q.description != null ? { description: q.description } : {}),
    required: q.required,
    ...(q.requiredMessage != null ? { requiredMessage: q.requiredMessage } : {}),
    ...(q.groupId != null ? { groupId: q.groupId } : {}),
    ...(q.options != null ? { options: q.options as NonNullable<QuestionType['options']> } : {}),
    ...(q.selectLevels != null
      ? { selectLevels: q.selectLevels as NonNullable<QuestionType['selectLevels']> }
      : {}),
    ...(q.tableTitle != null ? { tableTitle: q.tableTitle } : {}),
    ...(q.tableColumns != null
      ? { tableColumns: q.tableColumns as NonNullable<QuestionType['tableColumns']> }
      : {}),
    ...(q.tableRowsData != null
      ? { tableRowsData: q.tableRowsData as NonNullable<QuestionType['tableRowsData']> }
      : {}),
    ...(q.tableHeaderGrid != null
      ? { tableHeaderGrid: q.tableHeaderGrid as NonNullable<QuestionType['tableHeaderGrid']> }
      : {}),
    order: q.order,
    ...(q.allowOtherOption != null ? { allowOtherOption: q.allowOtherOption } : {}),
    ...(q.optionsColumns != null ? { optionsColumns: q.optionsColumns } : {}),
    ...(q.optionsAlign != null ? { optionsAlign: q.optionsAlign } : {}),
    ...(q.mobileOptionsColumns != null ? { mobileOptionsColumns: q.mobileOptionsColumns } : {}),
    ...(q.rankingConfig != null ? { rankingConfig: q.rankingConfig } : {}),
    ...(q.choiceGroups != null ? { choiceGroups: q.choiceGroups } : {}),
    ...(q.minSelections != null ? { minSelections: q.minSelections } : {}),
    ...(q.maxSelections != null ? { maxSelections: q.maxSelections } : {}),
    ...(q.noticeContent != null ? { noticeContent: q.noticeContent } : {}),
    ...(q.noticeBgColor != null ? { noticeBgColor: q.noticeBgColor } : {}),
    ...(q.requiresAcknowledgment != null
      ? { requiresAcknowledgment: q.requiresAcknowledgment }
      : {}),
    ...(q.placeholder != null ? { placeholder: q.placeholder } : {}),
    ...(q.defaultValueTemplate != null ? { defaultValueTemplate: q.defaultValueTemplate } : {}),
    ...((q.inputType as InputType | null) != null
      ? { inputType: q.inputType as InputType }
      : {}),
    ...(q.emptyDefault != null ? { emptyDefault: q.emptyDefault } : {}),
    ...(q.tableValidationRules != null
      ? {
          tableValidationRules: q.tableValidationRules as NonNullable<
            QuestionType['tableValidationRules']
          >,
        }
      : {}),
    ...(q.dynamicRowConfigs != null
      ? { dynamicRowConfigs: q.dynamicRowConfigs as NonNullable<QuestionType['dynamicRowConfigs']> }
      : {}),
    ...(q.rowRepeatConfig != null
      ? { rowRepeatConfig: q.rowRepeatConfig as NonNullable<QuestionType['rowRepeatConfig']> }
      : {}),
    ...(q.numberFormat != null
      ? { numberFormat: q.numberFormat as NonNullable<QuestionType['numberFormat']> }
      : {}),
    ...(q.textValidation != null
      ? { textValidation: q.textValidation as NonNullable<QuestionType['textValidation']> }
      : {}),
    ...(q.inputRows != null ? { inputRows: q.inputRows } : {}),
    ...(q.inputAutoGrow != null ? { inputAutoGrow: q.inputAutoGrow } : {}),
    ...(q.titleHtml != null ? { titleHtml: q.titleHtml } : {}),
    ...(q.sumConstraints != null
      ? { sumConstraints: q.sumConstraints as NonNullable<QuestionType['sumConstraints']> }
      : {}),
    ...(q.hideColumnLabels != null ? { hideColumnLabels: q.hideColumnLabels } : {}),
    ...(q.stickyColumnCount != null ? { stickyColumnCount: q.stickyColumnCount } : {}),
    ...(q.exportCellOrder != null ? { exportCellOrder: q.exportCellOrder } : {}),
    ...(q.mobileOriginalTable != null ? { mobileOriginalTable: q.mobileOriginalTable } : {}),
    ...(q.mobileTableDisplayMode != null
      ? { mobileTableDisplayMode: q.mobileTableDisplayMode }
      : {}),
    ...(q.mobileDrilldownOmitLeadingColumns != null
      ? { mobileDrilldownOmitLeadingColumns: q.mobileDrilldownOmitLeadingColumns }
      : {}),
    mobileDrilldownRepeatHeaderStartRow: q.mobileDrilldownRepeatHeaderStartRow,
    mobileDrilldownRepeatHeaderEndRow: q.mobileDrilldownRepeatHeaderEndRow,
    ...(q.hideTitle != null ? { hideTitle: q.hideTitle } : {}),
    ...(q.pageBreakBefore != null ? { pageBreakBefore: q.pageBreakBefore } : {}),
    ...(q.displayCondition != null
      ? { displayCondition: q.displayCondition as NonNullable<QuestionType['displayCondition']> }
      : {}),
    ...(q.priorAnswerCondition != null
      ? {
          priorAnswerCondition: q.priorAnswerCondition as NonNullable<
            QuestionType['priorAnswerCondition']
          >,
        }
      : {}),
    ...(q.priorAnswerDisabled != null ? { priorAnswerDisabled: q.priorAnswerDisabled } : {}),
    ...(q.questionCode != null ? { questionCode: q.questionCode } : {}),
    ...(q.isCustomSpssVarName != null ? { isCustomSpssVarName: q.isCustomSpssVarName } : {}),
    ...(q.exportLabel != null ? { exportLabel: q.exportLabel } : {}),
    ...(q.spssVarType != null
      ? { spssVarType: q.spssVarType as NonNullable<QuestionType['spssVarType']> }
      : {}),
    ...(q.spssMeasure != null
      ? { spssMeasure: q.spssMeasure as NonNullable<QuestionType['spssMeasure']> }
      : {}),
    ...(q.piiEncrypted != null ? { piiEncrypted: q.piiEncrypted } : {}),
    ...(q.answerQuoteEnabled != null ? { answerQuoteEnabled: q.answerQuoteEnabled } : {}),
    ...(q.answerQuoteName != null ? { answerQuoteName: q.answerQuoteName } : {}),
    ...(q.answerQuoteText != null ? { answerQuoteText: q.answerQuoteText } : {}),
  };
  // strip된 셀 데이터를 hydrate (cellCode, exportLabel, spssVarType 등 복원)
  if (mapped.type === 'table' && mapped.tableRowsData && mapped.tableColumns) {
    mapped.tableRowsData = generateAllCellCodes(
      mapped.questionCode,
      mapped.title,
      mapped.tableColumns,
      mapped.tableRowsData,
    );
  }
  // 일반 질문 옵션 코드 복원
  if (mapped.options && isCodedChoiceType(mapped.type)) {
    mapped.options = generateAllOptionCodes(mapped.options);
  }
  return mapped;
}

export async function getSurveyWithDetails(surveyId: string): Promise<SurveyType | null> {
  const survey = await getSurveyById(surveyId);
  if (!survey) return null;

  const groups = await getQuestionGroupsBySurvey(surveyId);
  const questionList = await getQuestionsBySurvey(surveyId);

  // DB 데이터를 클라이언트 타입으로 변환
  const surveyData: SurveyType = {
    id: survey.id,
    title: survey.title,
    ...(survey.description != null ? { description: survey.description } : {}),
    ...(survey.slug != null ? { slug: survey.slug } : {}),
    ...(survey.privateToken != null ? { privateToken: survey.privateToken } : {}),
    groups: groups.map((g) => ({
      id: g.id,
      surveyId: g.surveyId,
      name: g.name,
      ...(g.description != null ? { description: g.description } : {}),
      order: g.order,
      ...(g.parentGroupId != null ? { parentGroupId: g.parentGroupId } : {}),
      ...(g.color != null ? { color: g.color } : {}),
      ...(g.collapsed != null ? { collapsed: g.collapsed } : {}),
      ...(g.hideName != null ? { hideName: g.hideName } : {}),
      ...(g.nameDesign != null
        ? { nameDesign: g.nameDesign as NonNullable<QuestionGroup['nameDesign']> }
        : {}),
      ...(g.displayCondition != null
        ? { displayCondition: g.displayCondition as NonNullable<QuestionGroup['displayCondition']> }
        : {}),
    })),
    questions: questionList.map(mapQuestionRow),
    settings: {
      isPublic: survey.isPublic,
      allowMultipleResponses: survey.allowMultipleResponses,
      showProgressBar: survey.showProgressBar,
      shuffleQuestions: survey.shuffleQuestions,
      requireLogin: survey.requireLogin,
      ...(survey.endDate != null ? { endDate: survey.endDate } : {}),
      ...(survey.maxResponses != null ? { maxResponses: survey.maxResponses } : {}),
      ...(survey.piiRetentionUntil
        ? { piiRetentionUntil: retentionTimestampToDate(survey.piiRetentionUntil) }
        : {}),
      thankYouMessage: survey.thankYouMessage,
      screenedOutMessage: survey.screenedOutMessage ?? null,
      requireInviteToken: survey.requireInviteToken,
      forceWideLayout: survey.forceWideLayout,
      priorWaveLabel: survey.priorWaveLabel,
      changeConfirmEnabled: survey.changeConfirmEnabled,
      responseHeader: normalizeResponseHeaderConfig(survey.responseHeader),
    },
    lookups: survey.lookups ?? [],
    ...(survey.contactColumns != null ? { contactColumns: survey.contactColumns } : {}),
    contactEmail: survey.contactEmail ?? null,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
  };

  return surveyData;
}
