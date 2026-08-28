import { and, eq, isNull, ne } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets, surveyVersions, surveys } from '@/db/schema';
import { normalizeQuestions } from '@/lib/question';
import { normalizeResponseHeaderConfig } from '@/lib/survey/response-header-config';
import { isValidUUID } from '@/lib/utils';
import { findContactByInviteToken } from '@/server/read-models/invite-lookup';
import { getAllTags } from '@/server/read-models/library-taxonomy';
import { getResponseCountsGroupedBySurvey } from '@/server/read-models/responses';
import { isValidTestToken } from '@/server/read-models/survey-control';
import { countDeletedSurveys, getDeletedSurveys } from '@/server/read-models/survey-structure';
import {
  getQuestionGroupsBySurvey,
  getQuestionsBySurvey,
  getScopedSurveys,
  getSurveyById,
  getSurveyWithDetails,
} from '@/server/read-models/survey-structure';
import { getActiveTeamMemberships } from '@/server/read-models/team-memberships';
import { listActiveTeams } from '@/server/read-models/teams';
import { getVariableCatalog } from '@/server/read-models/variable-catalog';
import {
  SurveyAccessError,
  type SurveyAccessUser,
  loadAccessSubject,
} from '@/server/survey-access';
import { buildSurveyScopeFilter, resolveWorkScopeFor } from '@/server/work-scope';
import { normalizeSurveyStatus } from '@/shared/contracts/survey-builder-io';
import type { VariableDef } from '@/shared/contracts/template-variables';
import type { QuestionGroup, Question as QuestionType, Survey as SurveyType } from '@/types/survey';
import { generateAllCellCodes } from '@/utils/table-cell-code-generator';

import type {
  SlugAvailableInput,
  SurveyByPreviewTokenInput,
  SurveyByPrivateTokenInput,
  SurveyBySlugInput,
  SurveyForResponseInput,
  SurveyForResponseResult,
  SurveyIdRow,
  SurveyListResult,
} from '../domain/survey-read';

// 이 service 는 actions/query-actions 의 requireAuth 를 제거한다.
// 관리(빌더) 경로는 procedure 의 authed 미들웨어가 인증을 대체하고,
// 공개(응답자) 경로는 pub 미들웨어로 남겨 인증 강도를 byte 보존한다.
//
// 코드 복원(generateAllOptionCodes/generateAllCellCodes)·snapshot 우선+fallback·React.cache
// 불변식(E·G)은 유지한다. getSurveyWithDetails 본문은 publish/analytics 가 공유하는
// data/surveys.ts 단일 구현에 위임해 매핑 로직 중복(신규 컬럼 누락 위험)을 제거한다.

// 설문·그룹·질문 조회와 보관함 태그는 read-models 가 단일 구현을 소유한다.
// 이 service 는 그것을 자기 도메인 표면으로 다시 내보낼 뿐이다 —
// 사본을 두면 getSurveyById 처럼 React cache() 가 둘로 갈려 dedupe 불변식이 깨진다.
export {
  getAllTags,
  getQuestionGroupsBySurvey,
  getQuestionsBySurvey,
  getSurveyById,
  getSurveyWithDetails,
};

// ========================
// 설문 조회 (authed)
// ========================

/**
 * 슬러그 사용 가능 여부 확인.
 *
 * **삭제된 설문의 슬러그도 「사용 중」이다 — 일부러 그렇다**(티켓 17). `surveys.slug` 는
 * UNIQUE 라, 삭제됐다는 이유로 내주면 다른 설문이 그 값을 가져가고 그때부터 복구가 제약
 * 위반으로 영영 실패한다. soft delete 의 값어치가 복구인 이상 슬러그는 함께 예약된다.
 *
 * 다른 조회 경로들과 방향이 반대인 유일한 자리다 — 저쪽은 「삭제된 것을 감춘다」이고 여기는
 * 「삭제된 것도 자리를 지킨다」다. 화면에는 이름을 왜 못 쓰는지 보이지 않으므로(그 설문은
 * 안 보인다) 슈퍼어드민이 휴지통에서 확인해야 한다.
 */
export async function isSlugAvailable(input: SlugAvailableInput): Promise<boolean> {
  const { slug, excludeSurveyId } = input;
  const existing = await db.query.surveys.findFirst({
    where: excludeSurveyId
      ? and(eq(surveys.slug, slug), ne(surveys.id, excludeSurveyId))
      : eq(surveys.slug, slug),
  });
  return !existing;
}

// ========================
// 복합 조회 (authed)
// ========================

/**
 * 작업 범위로 좁힌 설문 목록 (역할 모델 v2 티켓 07).
 *
 * 판정은 전부 코어(work-scope)가 하고 여기는 조회를 잇는다. 범위를 해석한 결과를 함께
 * 돌려주는 이유는 화면이 요청한 범위와 서버가 해석한 범위가 다를 수 있어서다 — 해산된 팀이
 * 쿠키에 남은 경우가 그렇다.
 */
export async function getSurveyListWithCounts(
  user: SurveyAccessUser,
  requestedScope?: string | null,
  options: { deleted?: boolean } = {},
): Promise<SurveyListResult> {
  const subject = await loadAccessSubject(user);
  const scope = resolveWorkScopeFor(subject, requestedScope ?? null);
  const filter = buildSurveyScopeFilter(subject, scope);

  // 휴지통은 슈퍼어드민의 시스템 전체 보기에만 있다(티켓 17). 삭제된 설문은 팀 경계로
  // 좁힐 수 없어 — 해산된 팀의 것일 수도 있다 — 팀 화면에 두면 그 순간 전사 열람이 된다
  // (재배치 인박스가 슈퍼어드민 전용인 것과 같은 근거).
  const canSeeDeleted = subject.isSuperadmin && scope.kind === 'system';
  // 요청은 접지 않고 **거부한다**. 조용히 일반 목록으로 접으면 "휴지통이 비었다" 와
  // "휴지통을 볼 수 없다" 가 화면에서 같은 그림이 되고, 삭제된 설문이 없다고 오해한다.
  if (options.deleted && !canSeeDeleted) throw new SurveyAccessError('forbidden');

  const [surveyList, teams, deletedCount] = await Promise.all([
    options.deleted ? getDeletedSurveys() : getScopedSurveys(filter),
    listSelectableTeams(subject),
    canSeeDeleted ? countDeletedSurveys() : Promise.resolve(null),
  ]);
  const responseCounts = await getResponseCountsGroupedBySurvey(
    surveyList.map((survey) => survey.id),
  );

  return {
    scope,
    teams,
    canSeeSystemScope: subject.isSuperadmin,
    deletedCount,
    surveys: surveyList.map((survey) => ({
      id: survey.id,
      title: survey.title,
      description: survey.description,
      slug: survey.slug,
      privateToken: survey.privateToken,
      responseCount: responseCounts.get(survey.id)?.total ?? 0,
      completedResponseCount: responseCounts.get(survey.id)?.completed ?? 0,
      createdAt: survey.createdAt,
      updatedAt: survey.updatedAt,
      endDate: survey.endDate,
      isPublic: survey.isPublic,
      // text 컬럼이라 어휘로 접는다 — 캐스트 대신 로더 정규화(JSONB 드리프트 관례와 동일 취지).
      status: normalizeSurveyStatus(survey.status),
      teamId: survey.teamId,
      teamName: survey.teamName,
      visibility: survey.visibility,
      assignmentStatus: survey.assignmentStatus,
      // 화면 편의(작성자 표기·소유자 필터·버튼 노출 근사)다 — 판정은 서버 capability 가 한다.
      ownerUserId: survey.ownerUserId,
      ownerName: survey.ownerName,
      surveyGroupId: survey.surveyGroupId,
      // 일반 목록의 행은 언제나 null 이다(조회 조건이 deleted_at IS NULL) — 화면은 이 값으로
      // 「휴지통을 보고 있는가」를 판정한다.
      deletedAt: survey.deletedAt,
      isParticipant: survey.isParticipant,
    })),
  };
}

/** 스위처가 고를 수 있는 팀 — 내 활성 소속. 슈퍼어드민은 전 팀을 고를 수 있다. */
async function listSelectableTeams(
  subject: Awaited<ReturnType<typeof loadAccessSubject>>,
): Promise<{ id: string; name: string }[]> {
  if (subject.isSuperadmin) return listActiveTeams();
  return (await getActiveTeamMemberships(subject.userId)).map((m) => ({
    id: m.teamId,
    name: m.teamName,
  }));
}

// ========================
// 공개(pub) 응답자 조회 — requireAuth 없음
// ========================
//
// **이 구역은 관문이 없다 — deletedAt 필터를 각자 걸어야 한다**(티켓 17). 내부 표면은
// capability 코어가 `deleted_at IS NULL` 로 조회해 삭제된 설문을 not_found 로 접지만,
// 응답자 경로에는 그 코어가 서지 않는다. 슬러그·비공개 토큰·미리보기 토큰은 삭제된 설문을
// 여는 마지막 열쇠가 되므로 조회 조건에 함께 건다.
// `tests/integration/soft-delete-invisibility.realdb.test.ts` 가 이 구역 전수를 음성으로 고정한다.

// 슬러그로 설문 조회 (pub — 익명 응답자 진입).
// 익명 노출 경로이므로 full row 를 반환하지 않고 호출자(use-survey-loader)가 실제 쓰는 id 만
// 투영한다. testToken/testModeEnabled/isPaused/pausedMessage/privateToken 유출 차단(I-3).
export async function getSurveyBySlug(input: SurveyBySlugInput): Promise<SurveyIdRow | undefined> {
  const survey = await db.query.surveys.findFirst({
    where: and(eq(surveys.slug, input.slug), isNull(surveys.deletedAt)),
    columns: { id: true },
  });
  return survey;
}

// 비공개 토큰으로 설문 조회 (pub). 토큰으로 조회하되(로직 유지) 반환은 id 만 투영(I-3).
//
// privateToken 컬럼은 uuid 타입이라 비-UUID 값으로 조회하면 PG 가
// 22P02(invalid input syntax for type uuid) 를 던진다. 인증 없는 공개 라우트
// (/preview/[token] 등)에서 호출되므로 형태가 다른 값은 DB 까지 보내지 않고
// throw 없이 undefined 로 흡수한다 — lookupContactByToken(mail/services/unsubscribe.ts)
// 과 동일 패턴. 서비스 레벨에서 막아야 RPC 프로시저 직접 호출 경로까지 함께 보호된다.
export async function getSurveyByPrivateToken(
  input: SurveyByPrivateTokenInput,
): Promise<SurveyIdRow | undefined> {
  if (!isValidUUID(input.token)) return undefined;

  const survey = await db.query.surveys.findFirst({
    where: and(eq(surveys.privateToken, input.token), isNull(surveys.deletedAt)),
    columns: { id: true },
  });
  return survey;
}

// 공개 읽기전용 미리보기 토큰으로 설문 조회 (인증 없음, /preview/[token] 전용).
// privateToken(응답 크레덴셜)과 완전히 분리된 컬럼만 조회한다 — id/slug/privateToken 으로는
// 절대 매칭하지 않는다(previewToken 이 답변 크레덴셜로 오용되는 것을 막는 핵심 불변식).
// 반환은 getSurveyByPrivateToken 과 동일하게 id 만 투영(I-3).
//
// previewToken 컬럼도 uuid 타입이라 비-UUID 값으로 조회하면 PG 가
// 22P02(invalid input syntax for type uuid) 를 던진다. getSurveyByPrivateToken 과 동일한
// 이유로 형태가 다른 값은 DB 까지 보내지 않고 throw 없이 undefined 로 흡수한다.
export async function getSurveyByPreviewToken(
  input: SurveyByPreviewTokenInput,
): Promise<SurveyIdRow | undefined> {
  if (!isValidUUID(input.token)) return undefined;

  const survey = await db.query.surveys.findFirst({
    where: and(eq(surveys.previewToken, input.token), isNull(surveys.deletedAt)),
    columns: { id: true },
  });
  return survey;
}

// 응답 페이지용 설문 조회 (배포 버전 스냅샷 우선, fallback 기존 방식)
export async function getSurveyForResponse(
  input: SurveyForResponseInput,
  options: { requirePublished?: boolean } = {},
): Promise<SurveyForResponseResult> {
  const { surveyId } = input;
  const survey = await getSurveyById(surveyId);
  if (!survey) return null;

  // 응답 페이지 첫 화면 게이트용 라이브 제어값. snapshot 밖 값이므로 항상 현재
  // surveys 행에서 읽는다 — snapshot.settings 에서 가져오면 안 된다.
  let testSession: 'none' | 'valid' | 'invalid' = 'none';
  let testSessionKind: 'anonymous' | 'target' | null = null;

  if (input.inviteToken != null && input.testToken != null) {
    testSession = 'invalid';
  } else if (input.inviteToken != null) {
    const invite = await findContactByInviteToken(surveyId, input.inviteToken);
    if (invite.kind === 'invalid_test') {
      testSession = 'invalid';
    } else if (invite.kind === 'valid' && invite.isTest) {
      testSession = 'valid';
      testSessionKind = 'target';
    }
  } else if (input.testToken != null) {
    const tokenIsValid = isValidTestToken(survey, input.testToken);
    const testTarget = tokenIsValid
      ? await db.query.contactTargets.findFirst({
          where: and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, true)),
          columns: { id: true },
        })
      : null;
    if (tokenIsValid && !testTarget) {
      testSession = 'valid';
      testSessionKind = 'anonymous';
    } else {
      testSession = 'invalid';
    }
  }
  const control = {
    isPaused: survey.isPaused,
    pausedMessage: survey.pausedMessage,
    testSession,
    testSessionKind,
  };

  // 배포된 버전이 있으면 스냅샷 기반으로 반환
  if (survey.currentVersionId) {
    const version = await db.query.surveyVersions.findFirst({
      where: eq(surveyVersions.id, survey.currentVersionId),
    });

    if (version && version.snapshot) {
      const snapshot = version.snapshot as {
        title: string;
        description?: string;
        questions: QuestionType[];
        groups: QuestionGroup[];
        settings: {
          isPublic: boolean;
          allowMultipleResponses: boolean;
          showProgressBar: boolean;
          shuffleQuestions: boolean;
          requireLogin: boolean;
          endDate?: string;
          maxResponses?: number;
          thankYouMessage: string;
          // publish 시점 freeze 값. 이전 publish 본은 undefined → 현재 surveys 행으로 fallback.
          requireInviteToken?: boolean;
          forceWideLayout?: boolean;
          responseHeader?: SurveyType['settings']['responseHeader'];
        };
        // T17 이후 snapshot 에 포함. 이전 publish 본은 undefined → DB 의 현재 lookups 로 fallback.
        lookups?: SurveyType['lookups'];
      };

      // endDate 는 snapshot 에서 string 으로 보관되므로 spread 전에 분리해 Date 로 재구성한다
      // (base spread 가 string endDate 를 끌고오면 string | Date 로 충돌).
      const { endDate: snapshotEndDate, ...snapshotSettingsRest } = snapshot.settings;
      const surveyData: SurveyType = {
        id: survey.id,
        title: snapshot.title,
        ...(snapshot.description != null ? { description: snapshot.description } : {}),
        ...(survey.slug != null ? { slug: survey.slug } : {}),
        ...(survey.privateToken != null ? { privateToken: survey.privateToken } : {}),
        groups: snapshot.groups,
        // survey_versions 스냅샷 읽기 경계(공개 응답자 경로): 세대별 키셋이 다른 질문을
        // 정규화(보존 모드)로 수렴 — 무변형 passthrough, 알 수 없는 형태만 관측 로그.
        // 이후 table 셀 코드 복원 불변식은 동일하게 유지한다.
        questions: normalizeQuestions(snapshot.questions).map((q) => {
          if (q.type === 'table' && q.tableRowsData && q.tableColumns) {
            return {
              ...q,
              tableRowsData: generateAllCellCodes(
                q.questionCode,
                q.title,
                q.tableColumns,
                q.tableRowsData,
              ),
            };
          }
          return q;
        }),
        settings: {
          ...snapshotSettingsRest,
          ...(snapshotEndDate ? { endDate: new Date(snapshotEndDate) } : {}),
          // snapshot 기반 원칙: published 응답 페이지는 freeze 된 snapshot 값을 따른다.
          // 빌더 draft 의 invite-token 토글이 live 응답 페이지에 새지 않도록 현재 surveys 행으로
          // 덮어쓰지 않는다. snapshot 에 값이 없는 이전 publish 본만 현재 행으로 fallback.
          requireInviteToken: snapshot.settings.requireInviteToken ?? survey.requireInviteToken,
          // snapshot 기반 원칙 동일: freeze 값 우선, 없는 이전 publish 본만 현재 행으로 fallback.
          forceWideLayout: snapshot.settings.forceWideLayout ?? survey.forceWideLayout,
          // snapshot 기반 원칙 동일: published 응답 페이지는 freeze 된 snapshot 값을 따른다.
          // 값이 없는 이전 publish 본은 현재 surveys 행이 아니라 새 기본형으로 fallback.
          responseHeader: normalizeResponseHeaderConfig(snapshot.settings.responseHeader),
        },
        lookups: snapshot.lookups ?? survey.lookups ?? [],
        ...(survey.contactColumns != null ? { contactColumns: survey.contactColumns } : {}),
        quotaGate:
          survey.quotaConfig && survey.quotaConfig.enabled
            ? { questionIds: survey.quotaConfig.dimensions.map((d) => d.questionId) }
            : null,
        contactEmail: survey.contactEmail ?? null,
        createdAt: survey.createdAt,
        updatedAt: survey.updatedAt,
      };

      return { survey: surveyData, versionId: version.id, control };
    }
  }

  if (options.requirePublished) return null;

  // 미배포 설문: 기존 방식 fallback
  const surveyData = await getSurveyWithDetails(surveyId);
  if (!surveyData) return null;

  const quotaGate =
    survey.quotaConfig && survey.quotaConfig.enabled
      ? { questionIds: survey.quotaConfig.dimensions.map((d) => d.questionId) }
      : null;

  return { survey: { ...surveyData, quotaGate }, versionId: null, control };
}

// ========================
// Library 태그 / Variable Catalog (authed)
// ========================

// 빌더 변수 메뉴(prefill)용 카탈로그. getVariableCatalog 는 이미 server-only + React.cache.
// 이동하지 않고 제자리 import (불변식 — cache 유지).
export async function getVariableCatalogForSurvey(surveyId: string): Promise<VariableDef[]> {
  return getVariableCatalog(surveyId, { purpose: 'survey' });
}
