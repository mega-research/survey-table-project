import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  NewQuestion,
  NewQuestionGroup,
  questionGroups,
  questions,
  surveys,
} from '@/db/schema';
import type { CompleteQuestionWrite } from '@/db/schema/question-persisted-fields';
import { extractImageUrlsFromQuestions } from '@/lib/image-extractor';
import { deleteImagesFromR2Server, deleteR2ObjectsByKey } from '@/lib/image-utils-server';
import {
  promoteSurveyImages,
  promoteSurveyResponseHeader,
} from '@/lib/survey/survey-image-promote';
import {
  extractPermanentAttachmentKeysFromQuestions,
  promoteNoticeAttachments,
} from '@/lib/survey/notice-attachment-promote';
import type {
  Question,
  Survey as SurveyType,
} from '@/types/survey';
import { stripOptionCodes } from '@/utils/option-code-generator';
import { stripTableRowsData } from '@/utils/table-cell-optimizer';

import type {
  SaveResult,
  SurveyDiffPayload,
  SurveyDiffPayloadInput,
} from '../../domain/survey-save';

// 원본 interface SurveyDiffPayload 를 re-export(소비처 use-survey-sync 가 import type).
export type { SurveyDiffPayload };

/**
 * slug 정규화: 빈 문자열('')을 null 로 변환한다.
 *
 * 사용자가 커스텀 URL 입력을 비우면 store 는 slug:'' 를 그대로 보낸다(undefined 가 아니라
 * payload 에 포함됨). slug 컬럼은 UNIQUE 이고 Postgres 는 여러 NULL 은 충돌로 보지 않지만
 * 여러 '' 는 충돌로 본다. 따라서 '' 를 그대로 쓰면 두 번째 빈 slug 저장에서 친절한
 * '이미 사용 중인 URL입니다' 대신 raw unique-constraint 에러가 난다. '' 를 null 로
 * 정규화해 컬럼 의미(미설정 = NULL)에 맞춘다. 공백만 입력한 경우도 미설정으로 간주.
 */
export function normalizeSlug(slug: string | null | undefined): string | null {
  if (slug == null) return null;
  const trimmed = slug.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ========================
// Diff 기반 설문 저장 (변경분만 전송)
// ========================
//
// 인증은 authed 미들웨어가 담당(requireAuth 제거). 캐시 갱신(revalidatePath)은
// 소비처 query invalidation(use-survey-sync)으로 대체한다.

export async function saveSurveyDiff(
  payload: SurveyDiffPayloadInput,
): Promise<SaveResult> {
  const { surveyId, metadata, groups: incomingGroups, questionChanges } = payload;

  // slug 정규화: '' -> null (UNIQUE 컬럼에 빈 문자열을 쓰면 두 번째부터 충돌)
  const normalizedSlug = metadata ? normalizeSlug(metadata.slug) : undefined;

  // slug 중복 사전 검사
  if (normalizedSlug) {
    const duplicate = await db.query.surveys.findFirst({
      where: and(eq(surveys.slug, normalizedSlug), sql`${surveys.id} != ${surveyId}`),
      columns: { id: true },
    });
    if (duplicate) {
      throw new Error('이미 사용 중인 URL입니다. 다른 URL을 입력해주세요.');
    }
  }

  return await db.transaction(async (tx) => {
    // 1. 메타데이터 업데이트
    if (metadata) {
      const promotedResponseHeader = await promoteSurveyResponseHeader(
        metadata.settings.responseHeader,
      );
      await tx
        .update(surveys)
        .set({
          title: metadata.title,
          description: metadata.description,
          // slug 가 payload 에 실려 온 경우에만 set(diff 의미 보존). '' / 공백은 null 로 정규화해
          // UNIQUE 컬럼 충돌을 막는다. slug 미포함(undefined) 시에는 손대지 않아 기존 값 보존.
          ...(metadata.slug !== undefined ? { slug: normalizedSlug } : {}),
          // 링크 재발급(revocation): privateToken 변경분이 metadata 에 실려 오면 DB 에 반영해야
          // 옛 링크가 무효화된다. 누락 시 새 토큰이 영속되지 않아 기존 링크가 계속 유효한 버그.
          ...(metadata.privateToken !== undefined ? { privateToken: metadata.privateToken } : {}),
          contactEmail: metadata.contactEmail ?? null,
          isPublic: metadata.settings.isPublic,
          allowMultipleResponses: metadata.settings.allowMultipleResponses,
          showProgressBar: metadata.settings.showProgressBar,
          shuffleQuestions: metadata.settings.shuffleQuestions,
          requireLogin: metadata.settings.requireLogin,
          endDate: metadata.settings.endDate ? new Date(metadata.settings.endDate) : null,
          maxResponses: metadata.settings.maxResponses ?? null,
          thankYouMessage: metadata.settings.thankYouMessage,
          requireInviteToken: metadata.settings.requireInviteToken ?? false,
          responseHeader: promotedResponseHeader ?? null,
          updatedAt: new Date(),
        })
        .where(eq(surveys.id, surveyId));
    }

    // 2. 그룹 처리 (displayCondition 보존 포함)
    if (incomingGroups) {
      // displayCondition 보존 로직
      const existingGroups = await tx.query.questionGroups.findMany({
        where: eq(questionGroups.surveyId, surveyId),
      });

      const preservedGroups = incomingGroups.map((group) => {
        if (group.displayCondition) return group;
        const existing = existingGroups.find((g) => g.id === group.id);
        if (existing?.displayCondition) {
          return {
            ...group,
            displayCondition: existing.displayCondition as NonNullable<
              SurveyType['groups']
            >[0]['displayCondition'],
          };
        }
        return group;
      });

      // 삭제된 그룹 처리
      const newGroupIds = new Set(preservedGroups.map((g) => g.id));
      const groupIdsToRemove = existingGroups
        .filter((g) => !newGroupIds.has(g.id))
        .map((g) => g.id);

      if (groupIdsToRemove.length > 0) {
        await tx.delete(questionGroups).where(inArray(questionGroups.id, groupIdsToRemove));
      }

      if (preservedGroups.length > 0) {
        const groupValues = preservedGroups.map((group) => ({
          id: group.id,
          surveyId,
          name: group.name,
          description: group.description,
          order: group.order,
          parentGroupId: group.parentGroupId || null,
          color: group.color,
          collapsed: group.collapsed,
          hideName: group.hideName,
          nameDesign: group.nameDesign as NewQuestionGroup['nameDesign'],
          displayCondition: group.displayCondition as NewQuestionGroup['displayCondition'],
          updatedAt: new Date(),
        }));

        await tx
          .insert(questionGroups)
          .values(groupValues)
          .onConflictDoUpdate({
            target: questionGroups.id,
            set: {
              name: sql`excluded.name`,
              description: sql`excluded.description`,
              order: sql`excluded.order`,
              parentGroupId: sql`excluded.parent_group_id`,
              color: sql`excluded.color`,
              collapsed: sql`excluded.collapsed`,
              hideName: sql`excluded.hide_name`,
              nameDesign: sql`excluded.name_design`,
              displayCondition: sql`excluded.display_condition`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
    }

    // 3. 질문 변경분 처리
    if (questionChanges) {
      // 3a. 삭제
      if (questionChanges.deleted.length > 0) {
        const questionsToRemove = await tx.query.questions.findMany({
          where: inArray(questions.id, questionChanges.deleted),
        });
        const imagesToDelete = extractImageUrlsFromQuestions(questionsToRemove as Question[]);
        if (imagesToDelete.length > 0) {
          deleteImagesFromR2Server(imagesToDelete).catch(console.error);
        }
        const attachmentKeysToDelete = extractPermanentAttachmentKeysFromQuestions(
          questionsToRemove,
        );
        if (attachmentKeysToDelete.length > 0) {
          deleteR2ObjectsByKey(attachmentKeysToDelete).catch(console.error);
        }
        await tx.delete(questions).where(inArray(questions.id, questionChanges.deleted));
      }

      // 3b. Upsert (추가 + 수정)
      if (questionChanges.upserted.length > 0) {
        // 이전 publish 의 영구 첨부 키를 orphan 검출용으로 미리 fetch
        const upsertIds = questionChanges.upserted
          .map((q) => q.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        const previousQuestionRows =
          upsertIds.length > 0
            ? await tx.query.questions.findMany({
                where: inArray(questions.id, upsertIds),
                columns: { id: true, noticeContent: true, type: true },
              })
            : [];

        // tmp/survey/ 이미지를 영구 prefix로 promote (R2 move + URL 치환)
        // tmp/notice-attachment/ 첨부도 영구 prefix로 promote + 이전 영구 키 orphan cleanup
        const promotedQuestions = await promoteNoticeAttachments(
          await promoteSurveyImages(questionChanges.upserted),
          { previousQuestions: previousQuestionRows },
        );

        const questionValues = promotedQuestions.map((question) => ({
          id: question.id,
          surveyId,
          groupId: question.groupId || null,
          type: question.type,
          title: question.title,
          description: question.description,
          required: question.required,
          order: question.order,
          options: (question.options ? stripOptionCodes(question.options) : question.options) as NewQuestion['options'],
          selectLevels: question.selectLevels as NewQuestion['selectLevels'],
          tableTitle: question.tableTitle,
          tableColumns: question.tableColumns as NewQuestion['tableColumns'],
          tableRowsData: (question.type === 'table' && question.tableRowsData
            ? stripTableRowsData(question.tableRowsData)
            : question.tableRowsData) as NewQuestion['tableRowsData'],
          tableHeaderGrid: question.tableHeaderGrid as NewQuestion['tableHeaderGrid'],
          allowOtherOption: question.allowOtherOption,
          optionsColumns: question.optionsColumns,
          rankingConfig: question.rankingConfig as NewQuestion['rankingConfig'],
          choiceGroups: question.choiceGroups as NewQuestion['choiceGroups'],
          minSelections: question.minSelections,
          maxSelections: question.maxSelections,
          noticeContent: question.noticeContent,
          requiresAcknowledgment: question.requiresAcknowledgment,
          placeholder: question.placeholder,
          tableValidationRules:
            question.tableValidationRules as NewQuestion['tableValidationRules'],
          dynamicRowConfigs:
            question.dynamicRowConfigs as NewQuestion['dynamicRowConfigs'],
          hideColumnLabels: question.hideColumnLabels,
          hideTitle: question.hideTitle,
          displayCondition: question.displayCondition as NewQuestion['displayCondition'],
          questionCode: question.questionCode,
          isCustomSpssVarName: question.isCustomSpssVarName,
          exportLabel: question.exportLabel,
          spssVarType: question.spssVarType,
          spssMeasure: question.spssMeasure,
          defaultValueTemplate: question.defaultValueTemplate ?? null,
          inputType: question.inputType ?? null,
          emptyDefault: question.emptyDefault ?? null,
          pageBreakBefore: question.pageBreakBefore,
          updatedAt: new Date(),
        }) satisfies CompleteQuestionWrite);

        await tx
          .insert(questions)
          .values(questionValues)
          .onConflictDoUpdate({
            target: questions.id,
            set: {
              groupId: sql`excluded.group_id`,
              type: sql`excluded.type`,
              title: sql`excluded.title`,
              description: sql`excluded.description`,
              required: sql`excluded.required`,
              order: sql`excluded.order`,
              options: sql`excluded.options`,
              selectLevels: sql`excluded.select_levels`,
              tableTitle: sql`excluded.table_title`,
              tableColumns: sql`excluded.table_columns`,
              tableRowsData: sql`excluded.table_rows_data`,
              tableHeaderGrid: sql`excluded.table_header_grid`,
              allowOtherOption: sql`excluded.allow_other_option`,
              optionsColumns: sql`excluded.options_columns`,
              rankingConfig: sql`excluded.ranking_config`,
              choiceGroups: sql`excluded.choice_groups`,
              minSelections: sql`excluded.min_selections`,
              maxSelections: sql`excluded.max_selections`,
              noticeContent: sql`excluded.notice_content`,
              requiresAcknowledgment: sql`excluded.requires_acknowledgment`,
              placeholder: sql`excluded.placeholder`,
              tableValidationRules: sql`excluded.table_validation_rules`,
              dynamicRowConfigs: sql`excluded.dynamic_row_config`,
              hideColumnLabels: sql`excluded.hide_column_labels`,
              hideTitle: sql`excluded.hide_title`,
              displayCondition: sql`excluded.display_condition`,
              questionCode: sql`excluded.question_code`,
              isCustomSpssVarName: sql`excluded.is_custom_spss_var_name`,
              exportLabel: sql`excluded.export_label`,
              spssVarType: sql`excluded.spss_var_type`,
              spssMeasure: sql`excluded.spss_measure`,
              defaultValueTemplate: sql`excluded.default_value_template`,
              inputType: sql`excluded.input_type`,
              emptyDefault: sql`excluded.empty_default`,
              pageBreakBefore: sql`excluded.page_break_before`,
              updatedAt: sql`excluded.updated_at`,
            } satisfies CompleteQuestionWrite,
          });
      }

      // 3c. 순서 변경 (reorderedIds에 있지만 upserted에 없는 질문들의 order 업데이트)
      if (questionChanges.reorderedIds) {
        const upsertedIds = new Set(questionChanges.upserted.map((q) => q.id));
        const orderUpdates = questionChanges.reorderedIds
          .map((id, index) => ({ id, order: index + 1 }))
          .filter(({ id }) => !upsertedIds.has(id)); // upsert된 질문은 이미 order 포함

        for (const { id, order } of orderUpdates) {
          await tx
            .update(questions)
            .set({ order, updatedAt: new Date() })
            .where(eq(questions.id, id));
        }
      }
    }

    return { surveyId };
  });
}

// ========================
// 전체 설문 저장 (설문 + 그룹 + 질문 일괄) — 신규 생성 전용
// ========================

export async function saveSurveyWithDetails(
  surveyData: SurveyType,
): Promise<SaveResult> {
  // slug 정규화: '' -> null (UNIQUE 컬럼에 빈 문자열을 쓰면 두 번째부터 충돌)
  const normalizedSlug = normalizeSlug(surveyData.slug);

  // slug 중복 사전 검사
  if (normalizedSlug) {
    const duplicate = await db.query.surveys.findFirst({
      where: and(eq(surveys.slug, normalizedSlug), sql`${surveys.id} != ${surveyData.id}`),
      columns: { id: true },
    });
    if (duplicate) {
      throw new Error('이미 사용 중인 URL입니다. 다른 URL을 입력해주세요.');
    }
  }

  return await db.transaction(async (tx) => {
    const existingSurvey = await tx.query.surveys.findFirst({
      where: eq(surveys.id, surveyData.id),
    });
    const surveyId = surveyData.id;
    const promotedResponseHeader = await promoteSurveyResponseHeader(
      surveyData.settings.responseHeader,
    );

    if (existingSurvey) {
      // lookups 는 별도 server action(보관함 자동 sync, upsertSurveyLookupAction 등)으로
      // 갱신될 수 있어 빌더 store 가 stale 일 수 있다. surveyData.lookups 가 undefined 면
      // 명시적으로 set 하지 않아 DB 의 최신 값 보존.
      const updateSet: Record<string, unknown> = {
        title: surveyData.title,
        description: surveyData.description,
        contactEmail: surveyData.contactEmail ?? null,
        isPublic: surveyData.settings.isPublic,
        allowMultipleResponses: surveyData.settings.allowMultipleResponses,
        showProgressBar: surveyData.settings.showProgressBar,
        shuffleQuestions: surveyData.settings.shuffleQuestions,
        requireLogin: surveyData.settings.requireLogin,
        endDate: surveyData.settings.endDate ? new Date(surveyData.settings.endDate) : null,
        maxResponses: surveyData.settings.maxResponses ?? null,
        thankYouMessage: surveyData.settings.thankYouMessage,
        requireInviteToken: surveyData.settings.requireInviteToken ?? false,
        responseHeader: promotedResponseHeader ?? null,
        updatedAt: new Date(),
      };
      // slug 가 실려 온 경우에만 set(undefined 면 기존 값 보존). '' / 공백은 null 로 정규화해
      // UNIQUE 컬럼 충돌을 막는다(여러 행이 '' 를 가지면 두 번째 저장부터 raw 제약 위반).
      if (surveyData.slug !== undefined) {
        updateSet['slug'] = normalizedSlug;
      }
      if (surveyData.lookups !== undefined) {
        updateSet['lookups'] = surveyData.lookups;
      }
      // 링크 재발급(revocation): privateToken 변경분이 실려 오면 DB 에 반영해야 옛 링크가 무효화됨
      // (saveSurveyDiff 의 metadata.set 과 동일한 누락 방지)
      if (surveyData.privateToken !== undefined) {
        updateSet['privateToken'] = surveyData.privateToken;
      }
      await tx
        .update(surveys)
        .set(updateSet)
        .where(eq(surveys.id, surveyData.id));
    } else {
      // INSERT 시점은 새 설문이라 lookups 가 비어있는 게 정상. surveyData.lookups 가 있으면 그대로, 없으면 빈 배열.
      await tx.insert(surveys).values({
        id: surveyData.id,
        title: surveyData.title,
        description: surveyData.description,
        slug: normalizedSlug,
        privateToken: surveyData.privateToken,
        contactEmail: surveyData.contactEmail ?? null,
        isPublic: surveyData.settings.isPublic,
        allowMultipleResponses: surveyData.settings.allowMultipleResponses,
        showProgressBar: surveyData.settings.showProgressBar,
        shuffleQuestions: surveyData.settings.shuffleQuestions,
        requireLogin: surveyData.settings.requireLogin,
        endDate: surveyData.settings.endDate ? new Date(surveyData.settings.endDate) : null,
        maxResponses: surveyData.settings.maxResponses ?? null,
        thankYouMessage: surveyData.settings.thankYouMessage,
        requireInviteToken: surveyData.settings.requireInviteToken ?? false,
        responseHeader: promotedResponseHeader ?? null,
        lookups: surveyData.lookups ?? [],
      });
    }

    // 그룹 displayCondition 보존 로직
    if (existingSurvey && surveyData.groups) {
      const existingGroups = await tx.query.questionGroups.findMany({
        where: eq(questionGroups.surveyId, surveyId),
      });

      surveyData.groups = surveyData.groups.map((group) => {
        if (group.displayCondition) return group;
        const existingGroup = existingGroups.find((g) => g.id === group.id);
        if (existingGroup?.displayCondition != null) {
          return {
            ...group,
            displayCondition: existingGroup.displayCondition as NonNullable<
              SurveyType['groups']
            >[0]['displayCondition'],
          } as typeof group;
        }
        return group;
      });
    }

    if (!surveyData.questions) surveyData.questions = [];
    if (!surveyData.groups) surveyData.groups = [];

    // 질문 그룹 처리 (Bulk Upsert)
    if (surveyData.groups.length > 0) {
      const existingGroups = existingSurvey
        ? await tx.query.questionGroups.findMany({
            where: eq(questionGroups.surveyId, surveyId),
            columns: { id: true },
          })
        : [];

      const newGroupIds = new Set(surveyData.groups.map((g) => g.id));
      const groupIdsToRemove = existingGroups
        .filter((g) => !newGroupIds.has(g.id))
        .map((g) => g.id);

      if (groupIdsToRemove.length > 0) {
        await tx.delete(questionGroups).where(inArray(questionGroups.id, groupIdsToRemove));
      }

      const groupValues = surveyData.groups.map((group) => ({
        id: group.id,
        surveyId,
        name: group.name,
        description: group.description,
        order: group.order,
        parentGroupId: group.parentGroupId || null,
        color: group.color,
        collapsed: group.collapsed,
        hideName: group.hideName,
        nameDesign: group.nameDesign as NewQuestionGroup['nameDesign'],
        displayCondition: group.displayCondition as NewQuestionGroup['displayCondition'],
        updatedAt: new Date(),
      }));

      await tx
        .insert(questionGroups)
        .values(groupValues)
        .onConflictDoUpdate({
          target: questionGroups.id,
          set: {
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            order: sql`excluded.order`,
            parentGroupId: sql`excluded.parent_group_id`,
            color: sql`excluded.color`,
            collapsed: sql`excluded.collapsed`,
            hideName: sql`excluded.hide_name`,
            nameDesign: sql`excluded.name_design`,
            displayCondition: sql`excluded.display_condition`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }

    // 질문 처리 (Bulk Upsert)
    if (surveyData.questions) {
      const existingQuestions = existingSurvey
        ? await tx.query.questions.findMany({
            where: eq(questions.surveyId, surveyId),
            columns: { id: true },
          })
        : [];

      const newQuestionIds = new Set(surveyData.questions.map((q) => q.id));
      const questionIdsToRemove = existingQuestions
        .filter((q) => !newQuestionIds.has(q.id))
        .map((q) => q.id);

      if (questionIdsToRemove.length > 0) {
        const questionsToRemove = await tx.query.questions.findMany({
          where: inArray(questions.id, questionIdsToRemove),
        });
        const imagesToDelete = extractImageUrlsFromQuestions(questionsToRemove as Question[]);
        if (imagesToDelete.length > 0) {
          deleteImagesFromR2Server(imagesToDelete).catch(console.error);
        }
        const attachmentKeysToDelete = extractPermanentAttachmentKeysFromQuestions(
          questionsToRemove,
        );
        if (attachmentKeysToDelete.length > 0) {
          deleteR2ObjectsByKey(attachmentKeysToDelete).catch(console.error);
        }

        await tx.delete(questions).where(inArray(questions.id, questionIdsToRemove));
      }

      if (surveyData.questions.length > 0) {
        // 이전 영구 첨부 키 orphan 검출용으로 fetch (전체 questions 덮어쓰기 흐름)
        const previousQuestionRows = existingSurvey
          ? await tx.query.questions.findMany({
              where: eq(questions.surveyId, surveyId),
              columns: { id: true, noticeContent: true, type: true },
            })
          : [];

        // tmp/survey/ 이미지를 영구 prefix로 promote (R2 move + URL 치환)
        // tmp/notice-attachment/ 첨부도 영구 prefix로 promote + 이전 영구 키 orphan cleanup
        const promotedQuestions = await promoteNoticeAttachments(
          await promoteSurveyImages(surveyData.questions),
          { previousQuestions: previousQuestionRows },
        );

        const questionValues = promotedQuestions.map((question) => ({
          id: question.id,
          surveyId,
          groupId: question.groupId || null,
          type: question.type,
          title: question.title,
          description: question.description,
          required: question.required,
          order: question.order,
          options: (question.options ? stripOptionCodes(question.options) : question.options) as NewQuestion['options'],
          selectLevels: question.selectLevels as NewQuestion['selectLevels'],
          tableTitle: question.tableTitle,
          tableColumns: question.tableColumns as NewQuestion['tableColumns'],
          tableRowsData: (question.type === 'table' && question.tableRowsData
            ? stripTableRowsData(question.tableRowsData)
            : question.tableRowsData) as NewQuestion['tableRowsData'],
          tableHeaderGrid: question.tableHeaderGrid as NewQuestion['tableHeaderGrid'],
          allowOtherOption: question.allowOtherOption,
          optionsColumns: question.optionsColumns,
          rankingConfig: question.rankingConfig as NewQuestion['rankingConfig'],
          choiceGroups: question.choiceGroups as NewQuestion['choiceGroups'],
          minSelections: question.minSelections,
          maxSelections: question.maxSelections,
          noticeContent: question.noticeContent,
          requiresAcknowledgment: question.requiresAcknowledgment,
          placeholder: question.placeholder,
          tableValidationRules:
            question.tableValidationRules as NewQuestion['tableValidationRules'],
          dynamicRowConfigs:
            question.dynamicRowConfigs as NewQuestion['dynamicRowConfigs'],
          hideColumnLabels: question.hideColumnLabels,
          hideTitle: question.hideTitle,
          displayCondition: question.displayCondition as NewQuestion['displayCondition'],
          questionCode: question.questionCode,
          isCustomSpssVarName: question.isCustomSpssVarName,
          exportLabel: question.exportLabel,
          spssVarType: question.spssVarType,
          spssMeasure: question.spssMeasure,
          defaultValueTemplate: question.defaultValueTemplate ?? null,
          inputType: question.inputType ?? null,
          emptyDefault: question.emptyDefault ?? null,
          pageBreakBefore: question.pageBreakBefore,
          updatedAt: new Date(),
        }) satisfies CompleteQuestionWrite);

        await tx
          .insert(questions)
          .values(questionValues)
          .onConflictDoUpdate({
            target: questions.id,
            set: {
              groupId: sql`excluded.group_id`,
              type: sql`excluded.type`,
              title: sql`excluded.title`,
              description: sql`excluded.description`,
              required: sql`excluded.required`,
              order: sql`excluded.order`,
              options: sql`excluded.options`,
              selectLevels: sql`excluded.select_levels`,
              tableTitle: sql`excluded.table_title`,
              tableColumns: sql`excluded.table_columns`,
              tableRowsData: sql`excluded.table_rows_data`,
              tableHeaderGrid: sql`excluded.table_header_grid`,
              allowOtherOption: sql`excluded.allow_other_option`,
              optionsColumns: sql`excluded.options_columns`,
              rankingConfig: sql`excluded.ranking_config`,
              choiceGroups: sql`excluded.choice_groups`,
              minSelections: sql`excluded.min_selections`,
              maxSelections: sql`excluded.max_selections`,
              noticeContent: sql`excluded.notice_content`,
              requiresAcknowledgment: sql`excluded.requires_acknowledgment`,
              placeholder: sql`excluded.placeholder`,
              tableValidationRules: sql`excluded.table_validation_rules`,
              dynamicRowConfigs: sql`excluded.dynamic_row_config`,
              hideColumnLabels: sql`excluded.hide_column_labels`,
              hideTitle: sql`excluded.hide_title`,
              displayCondition: sql`excluded.display_condition`,
              questionCode: sql`excluded.question_code`,
              isCustomSpssVarName: sql`excluded.is_custom_spss_var_name`,
              exportLabel: sql`excluded.export_label`,
              spssVarType: sql`excluded.spss_var_type`,
              spssMeasure: sql`excluded.spss_measure`,
              defaultValueTemplate: sql`excluded.default_value_template`,
              inputType: sql`excluded.input_type`,
              emptyDefault: sql`excluded.empty_default`,
              pageBreakBefore: sql`excluded.page_break_before`,
              updatedAt: sql`excluded.updated_at`,
            } satisfies CompleteQuestionWrite,
          });
      }
    }

    return { surveyId };
  });
}
