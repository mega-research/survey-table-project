'use server';

import { revalidatePath } from 'next/cache';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  NewQuestion,
  NewQuestionGroup,
  questionGroups,
  questions,
  surveys,
} from '@/db/schema';
import { requireAuth } from '@/lib/auth';
import { extractImageUrlsFromQuestions } from '@/lib/image-extractor';
import { deleteImagesFromR2Server } from '@/lib/image-utils-server';
import { promoteSurveyImages } from '@/lib/survey/survey-image-promote';
import { promoteNoticeAttachments } from '@/lib/survey/notice-attachment-promote';
import type {
  Question,
  QuestionGroup,
  Survey as SurveyType,
  SurveySettings,
} from '@/types/survey';
import { stripOptionCodes } from '@/utils/option-code-generator';
import { stripTableRowsData } from '@/utils/table-cell-optimizer';

// ========================
// Diff 기반 설문 저장 (변경분만 전송)
// ========================

export interface SurveyDiffPayload {
  surveyId: string;
  metadata?: {
    title: string;
    description?: string;
    slug?: string;
    privateToken?: string;
    settings: SurveySettings;
    thankYouMessage?: string;
  };
  groups?: QuestionGroup[];
  questionChanges?: {
    upserted: Question[];     // 추가 + 수정된 질문 (전체 객체)
    deleted: string[];        // 삭제된 질문 ID
    reorderedIds?: string[];  // 전체 질문 ID 순서 (순서 변경 시에만)
  };
}

export async function saveSurveyDiff(payload: SurveyDiffPayload) {
  await requireAuth();

  const { surveyId, metadata, groups: incomingGroups, questionChanges } = payload;

  // slug 중복 사전 검사
  if (metadata?.slug) {
    const duplicate = await db.query.surveys.findFirst({
      where: and(eq(surveys.slug, metadata.slug), sql`${surveys.id} != ${surveyId}`),
      columns: { id: true },
    });
    if (duplicate) {
      throw new Error('이미 사용 중인 URL입니다. 다른 URL을 입력해주세요.');
    }
  }

  return await db.transaction(async (tx) => {
    // 1. 메타데이터 업데이트
    if (metadata) {
      await tx
        .update(surveys)
        .set({
          title: metadata.title,
          description: metadata.description,
          slug: metadata.slug,
          isPublic: metadata.settings.isPublic,
          allowMultipleResponses: metadata.settings.allowMultipleResponses,
          showProgressBar: metadata.settings.showProgressBar,
          shuffleQuestions: metadata.settings.shuffleQuestions,
          requireLogin: metadata.settings.requireLogin,
          endDate: metadata.settings.endDate ? new Date(metadata.settings.endDate) : null,
          maxResponses: metadata.settings.maxResponses ?? null,
          thankYouMessage: metadata.settings.thankYouMessage,
          requireInviteToken: metadata.settings.requireInviteToken ?? false,
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
        await tx.delete(questions).where(inArray(questions.id, questionChanges.deleted));
      }

      // 3b. Upsert (추가 + 수정)
      if (questionChanges.upserted.length > 0) {
        // tmp/survey/ 이미지를 영구 prefix로 promote (R2 move + URL 치환)
        const promotedQuestions = await promoteNoticeAttachments(
          await promoteSurveyImages(questionChanges.upserted),
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
          imageUrl: question.imageUrl,
          videoUrl: question.videoUrl,
          allowOtherOption: question.allowOtherOption,
          optionsColumns: question.optionsColumns,
          rankingConfig: question.rankingConfig as NewQuestion['rankingConfig'],
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
          displayCondition: question.displayCondition as NewQuestion['displayCondition'],
          questionCode: question.questionCode,
          isCustomSpssVarName: question.isCustomSpssVarName,
          exportLabel: question.exportLabel,
          spssVarType: question.spssVarType,
          spssMeasure: question.spssMeasure,
          defaultValueTemplate: question.defaultValueTemplate ?? null,
          updatedAt: new Date(),
        }));

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
              imageUrl: sql`excluded.image_url`,
              videoUrl: sql`excluded.video_url`,
              allowOtherOption: sql`excluded.allow_other_option`,
              optionsColumns: sql`excluded.options_columns`,
              rankingConfig: sql`excluded.ranking_config`,
              minSelections: sql`excluded.min_selections`,
              maxSelections: sql`excluded.max_selections`,
              noticeContent: sql`excluded.notice_content`,
              requiresAcknowledgment: sql`excluded.requires_acknowledgment`,
              placeholder: sql`excluded.placeholder`,
              tableValidationRules: sql`excluded.table_validation_rules`,
              dynamicRowConfigs: sql`excluded.dynamic_row_config`,
              hideColumnLabels: sql`excluded.hide_column_labels`,
              displayCondition: sql`excluded.display_condition`,
              questionCode: sql`excluded.question_code`,
              isCustomSpssVarName: sql`excluded.is_custom_spss_var_name`,
              exportLabel: sql`excluded.export_label`,
              spssVarType: sql`excluded.spss_var_type`,
              spssMeasure: sql`excluded.spss_measure`,
              defaultValueTemplate: sql`excluded.default_value_template`,
              updatedAt: sql`excluded.updated_at`,
            },
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

    revalidatePath('/admin/surveys');
    revalidatePath(`/admin/surveys/${surveyId}`);

    return { surveyId };
  });
}

// ========================
// 전체 설문 저장 (설문 + 그룹 + 질문 일괄) — 신규 생성 전용
// ========================

export async function saveSurveyWithDetails(surveyData: SurveyType) {
  await requireAuth();

  // slug 중복 사전 검사
  if (surveyData.slug) {
    const duplicate = await db.query.surveys.findFirst({
      where: and(eq(surveys.slug, surveyData.slug), sql`${surveys.id} != ${surveyData.id}`),
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

    if (existingSurvey) {
      // lookups 는 별도 server action(보관함 자동 sync, upsertSurveyLookupAction 등)으로
      // 갱신될 수 있어 빌더 store 가 stale 일 수 있다. surveyData.lookups 가 undefined 면
      // 명시적으로 set 하지 않아 DB 의 최신 값 보존.
      const updateSet: Record<string, unknown> = {
        title: surveyData.title,
        description: surveyData.description,
        slug: surveyData.slug,
        isPublic: surveyData.settings.isPublic,
        allowMultipleResponses: surveyData.settings.allowMultipleResponses,
        showProgressBar: surveyData.settings.showProgressBar,
        shuffleQuestions: surveyData.settings.shuffleQuestions,
        requireLogin: surveyData.settings.requireLogin,
        endDate: surveyData.settings.endDate ? new Date(surveyData.settings.endDate) : null,
        maxResponses: surveyData.settings.maxResponses ?? null,
        thankYouMessage: surveyData.settings.thankYouMessage,
        requireInviteToken: surveyData.settings.requireInviteToken ?? false,
        updatedAt: new Date(),
      };
      if (surveyData.lookups !== undefined) {
        updateSet.lookups = surveyData.lookups;
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
        slug: surveyData.slug,
        privateToken: surveyData.privateToken,
        isPublic: surveyData.settings.isPublic,
        allowMultipleResponses: surveyData.settings.allowMultipleResponses,
        showProgressBar: surveyData.settings.showProgressBar,
        shuffleQuestions: surveyData.settings.shuffleQuestions,
        requireLogin: surveyData.settings.requireLogin,
        endDate: surveyData.settings.endDate ? new Date(surveyData.settings.endDate) : null,
        maxResponses: surveyData.settings.maxResponses ?? null,
        thankYouMessage: surveyData.settings.thankYouMessage,
        requireInviteToken: surveyData.settings.requireInviteToken ?? false,
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
        if (existingGroup?.displayCondition) {
          return {
            ...group,
            displayCondition: existingGroup.displayCondition as NonNullable<
              SurveyType['groups']
            >[0]['displayCondition'],
          };
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

        await tx.delete(questions).where(inArray(questions.id, questionIdsToRemove));
      }

      if (surveyData.questions.length > 0) {
        // tmp/survey/ 이미지를 영구 prefix로 promote (R2 move + URL 치환)
        const promotedQuestions = await promoteNoticeAttachments(
          await promoteSurveyImages(surveyData.questions),
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
          imageUrl: question.imageUrl,
          videoUrl: question.videoUrl,
          allowOtherOption: question.allowOtherOption,
          optionsColumns: question.optionsColumns,
          rankingConfig: question.rankingConfig as NewQuestion['rankingConfig'],
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
          displayCondition: question.displayCondition as NewQuestion['displayCondition'],
          questionCode: question.questionCode,
          isCustomSpssVarName: question.isCustomSpssVarName,
          exportLabel: question.exportLabel,
          spssVarType: question.spssVarType,
          spssMeasure: question.spssMeasure,
          defaultValueTemplate: question.defaultValueTemplate ?? null,
          updatedAt: new Date(),
        }));

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
              imageUrl: sql`excluded.image_url`,
              videoUrl: sql`excluded.video_url`,
              allowOtherOption: sql`excluded.allow_other_option`,
              optionsColumns: sql`excluded.options_columns`,
              rankingConfig: sql`excluded.ranking_config`,
              minSelections: sql`excluded.min_selections`,
              maxSelections: sql`excluded.max_selections`,
              noticeContent: sql`excluded.notice_content`,
              requiresAcknowledgment: sql`excluded.requires_acknowledgment`,
              placeholder: sql`excluded.placeholder`,
              tableValidationRules: sql`excluded.table_validation_rules`,
              dynamicRowConfigs: sql`excluded.dynamic_row_config`,
              hideColumnLabels: sql`excluded.hide_column_labels`,
              displayCondition: sql`excluded.display_condition`,
              questionCode: sql`excluded.question_code`,
              isCustomSpssVarName: sql`excluded.is_custom_spss_var_name`,
              exportLabel: sql`excluded.export_label`,
              spssVarType: sql`excluded.spss_var_type`,
              spssMeasure: sql`excluded.spss_measure`,
              defaultValueTemplate: sql`excluded.default_value_template`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
    }

    revalidatePath('/admin/surveys');
    revalidatePath(`/admin/surveys/${surveyId}`);

    return { surveyId };
  });
}
