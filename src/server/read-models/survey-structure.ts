import 'server-only';

import { cache } from 'react';

import { and, count, desc, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { questionGroups, questions, surveyGroups, surveys, teams, users } from '@/db/schema';
import type { SurveyScopeFilter } from '@/server/work-scope';
import { retentionTimestampToDate } from '@/lib/survey/pii-retention';
import { normalizeResponseHeaderConfig } from '@/lib/survey/response-header-config';
import { isCodedChoiceType } from '@/types/question-types';
import type { QuestionGroup, Question as QuestionType, Survey as SurveyType } from '@/types/survey';
import { generateAllOptionCodes } from '@/utils/option-code-generator';
import { generateAllCellCodes } from '@/utils/table-cell-code-generator';

// ========================
// 설문 조회 함수
// ========================

// 무범위 목록(구 getSurveys)은 제거됐다(티켓 09) — 마지막 소비자였던 분석 대시보드가
// 작업 범위 목록(getSurveyListWithCounts)으로 옮겨 갔다. 목록은 항상 범위를 지나야 한다.

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
    conditions.push(eq(surveys.teamId, filter.teamId));
    if (!filter.seesInviteOnly) {
      // invite_only 는 소유 팀 팀원에게만 숨긴다 — 자기가 소유한 설문은 남는다(스펙 §3).
      // 참여자로 초대돼 보이는 타 팀 설문은 티켓 18 이 이 자리에 UNION 으로 붙인다.
      conditions.push(
        or(eq(surveys.visibility, 'team'), eq(surveys.ownerUserId, filter.viewerId))!,
      );
    }
  }

  return db
    .select({
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
      // 조건이 `deleted_at IS NULL` 이라 언제나 null 이다 — 삭제됨 목록(getDeletedSurveys)과
      // 같은 모양을 유지하려고 함께 투영한다. 화면이 이 값 하나로 두 목록을 가른다(티켓 17).
      deletedAt: surveys.deletedAt,
      // 그룹은 팀 소유물이라 팀이 다른 그룹 id 가 남아 있으면 그건 깨진 상태다(팀을 옮기는
      // 흐름이 surveyGroupId 를 안 내린 경우). 목록에서는 미분류로 보여 그 상태를 정상처럼
      // 그리지 않는다 — 그룹 화면 필터도 이 값을 보므로 유령 그룹에 갇히지 않는다.
      surveyGroupId: sql<
        string | null
      >`case when ${surveys.teamId} is not distinct from ${surveyGroups.teamId} then ${surveys.surveyGroupId} else null end`,
    })
    .from(surveys)
    .leftJoin(teams, eq(teams.id, surveys.teamId))
    .leftJoin(users, eq(users.id, surveys.ownerUserId))
    .leftJoin(surveyGroups, eq(surveyGroups.id, surveys.surveyGroupId))
    .where(and(...conditions))
    .orderBy(desc(surveys.createdAt));
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
      ...(g.nameDesign != null ? { nameDesign: g.nameDesign as NonNullable<QuestionGroup['nameDesign']> } : {}),
      ...(g.displayCondition != null ? { displayCondition: g.displayCondition as NonNullable<QuestionGroup['displayCondition']> } : {}),
    })),
    questions: questionList.map((q) => {
      const mapped: QuestionType = {
        id: q.id,
        type: q.type as QuestionType['type'],
        title: q.title,
        ...(q.description != null ? { description: q.description } : {}),
        required: q.required,
        ...(q.requiredMessage != null ? { requiredMessage: q.requiredMessage } : {}),
        ...(q.groupId != null ? { groupId: q.groupId } : {}),
        ...(q.options != null ? { options: q.options as NonNullable<QuestionType['options']> } : {}),
        ...(q.selectLevels != null ? { selectLevels: q.selectLevels as NonNullable<QuestionType['selectLevels']> } : {}),
        ...(q.tableTitle != null ? { tableTitle: q.tableTitle } : {}),
        ...(q.tableColumns != null ? { tableColumns: q.tableColumns as NonNullable<QuestionType['tableColumns']> } : {}),
        ...(q.tableRowsData != null ? { tableRowsData: q.tableRowsData as NonNullable<QuestionType['tableRowsData']> } : {}),
        ...(q.tableHeaderGrid != null ? { tableHeaderGrid: q.tableHeaderGrid as NonNullable<QuestionType['tableHeaderGrid']> } : {}),
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
        ...(q.requiresAcknowledgment != null ? { requiresAcknowledgment: q.requiresAcknowledgment } : {}),
        ...(q.placeholder != null ? { placeholder: q.placeholder } : {}),
        ...(q.defaultValueTemplate != null ? { defaultValueTemplate: q.defaultValueTemplate } : {}),
        ...((q.inputType as 'text' | 'number' | null) != null ? { inputType: q.inputType as 'text' | 'number' } : {}),
        ...(q.emptyDefault != null ? { emptyDefault: q.emptyDefault } : {}),
        ...(q.tableValidationRules != null ? { tableValidationRules: q.tableValidationRules as NonNullable<QuestionType['tableValidationRules']> } : {}),
        ...(q.dynamicRowConfigs != null ? { dynamicRowConfigs: q.dynamicRowConfigs as NonNullable<QuestionType['dynamicRowConfigs']> } : {}),
        ...(q.numberFormat != null ? { numberFormat: q.numberFormat as NonNullable<QuestionType['numberFormat']> } : {}),
        ...(q.sumConstraints != null ? { sumConstraints: q.sumConstraints as NonNullable<QuestionType['sumConstraints']> } : {}),
        ...(q.hideColumnLabels != null ? { hideColumnLabels: q.hideColumnLabels } : {}),
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
        ...(q.displayCondition != null ? { displayCondition: q.displayCondition as NonNullable<QuestionType['displayCondition']> } : {}),
        ...(q.questionCode != null ? { questionCode: q.questionCode } : {}),
        ...(q.isCustomSpssVarName != null ? { isCustomSpssVarName: q.isCustomSpssVarName } : {}),
        ...(q.exportLabel != null ? { exportLabel: q.exportLabel } : {}),
        ...(q.spssVarType != null ? { spssVarType: q.spssVarType as NonNullable<QuestionType['spssVarType']> } : {}),
        ...(q.spssMeasure != null ? { spssMeasure: q.spssMeasure as NonNullable<QuestionType['spssMeasure']> } : {}),
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
    }),
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
      requireInviteToken: survey.requireInviteToken,
      forceWideLayout: survey.forceWideLayout,
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
