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
import { extractR2KeysFromJsonbValue } from '@/lib/r2-lifecycle/key-extract';
import { collectSaveDiffAndRevival } from '@/lib/r2-lifecycle/save-diff-collector.server';
import { retentionDateToTimestamp } from '@/lib/survey/pii-retention';
import {
  promoteSurveyImages,
  promoteSurveyResponseHeader,
} from '@/lib/survey/survey-image-promote';
import { promoteNoticeAttachments } from '@/lib/survey/notice-attachment-promote';
import type { Survey as SurveyType } from '@/types/survey';
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

/**
 * 추적조사 회차 라벨 정규화. 공백만 입력한 경우는 미설정(NULL)으로 본다 —
 * 응답 화면이 기본 문구로 떨어지게 하려면 '' 이 아니라 NULL 이어야 한다.
 */
export function normalizePriorWaveLabel(label: string | null | undefined): string | null {
  if (label == null) return null;
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ========================
// Diff 기반 설문 저장 (변경분만 전송)
// ========================
//
// 인증은 authed 미들웨어가 담당(requireAuth 제거). 캐시 갱신(revalidatePath)은
// 소비처 query invalidation(use-survey-sync)으로 대체한다.

// 저장 diff 수집용 — 값에서 추출한 R2 키를 집합에 누적 (두 저장 경로 공용)
const addKeys = (set: Set<string>, value: unknown): void => {
  for (const k of extractR2KeysFromJsonbValue(value)) set.add(k);
};

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
    // 저장 diff 수집 — 비교는 payload 에 실려 온 범위(메타·삭제/업서트 질문)에
    // 한정한다. 빠진 키는 tx 끝에서 유예 삭제 큐에 등록되고 재등장 키는 취소된다.
    const oldContentKeys = new Set<string>();
    const newContentKeys = new Set<string>();

    // 1. 메타데이터 업데이트
    if (metadata) {
      const [oldSurveyContent] = await tx
        .select({
          responseHeader: surveys.responseHeader,
          description: surveys.description,
          thankYouMessage: surveys.thankYouMessage,
        })
        .from(surveys)
        .where(eq(surveys.id, surveyId));
      addKeys(oldContentKeys, oldSurveyContent);

      const promotedResponseHeader = await promoteSurveyResponseHeader(
        metadata.settings.responseHeader,
      );
      addKeys(newContentKeys, {
        responseHeader: promotedResponseHeader ?? null,
        description: metadata.description,
        thankYouMessage: metadata.settings.thankYouMessage,
      });
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
          piiRetentionUntil: metadata.settings.piiRetentionUntil
            ? retentionDateToTimestamp(metadata.settings.piiRetentionUntil)
            : null,
          maxResponses: metadata.settings.maxResponses ?? null,
          thankYouMessage: metadata.settings.thankYouMessage,
          requireInviteToken: metadata.settings.requireInviteToken ?? false,
          forceWideLayout: metadata.settings.forceWideLayout ?? false,
          priorWaveLabel: normalizePriorWaveLabel(metadata.settings.priorWaveLabel),
          changeConfirmEnabled: metadata.settings.changeConfirmEnabled ?? false,
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
      // 3a. 삭제 — 질문 삭제 시 R2 이미지/영구 첨부 키는 지우지 않는다. 발행 스냅샷
      // (survey_versions, 불변·응답 페이지 서빙 중)·복제 설문·보관함(saved_questions/
      // saved_cells)이 같은 URL·키를 참조할 수 있어 무확인 삭제가 그쪽 콘텐츠를 파괴한다.
      if (questionChanges.deleted.length > 0) {
        // 삭제 전 행 콘텐츠를 읽어 diff 의 old 측에 넣는다 — 빠진 키는 큐 후보로만
        // 등록되고, 집행 시 전역 재확인이 공유 참조를 거른다.
        const deletedRows = await tx
          .select()
          .from(questions)
          .where(inArray(questions.id, questionChanges.deleted));
        addKeys(oldContentKeys, deletedRows);
        await tx.delete(questions).where(inArray(questions.id, questionChanges.deleted));
      }

      // 3b. Upsert (추가 + 수정)
      if (questionChanges.upserted.length > 0) {
        // tmp/survey/ 이미지를 영구 prefix로 promote (R2 copy + URL 치환, 원본 tmp 는 lifecycle 위임)
        // tmp/notice-attachment/ 첨부도 영구 prefix로 promote. 이전 영구 첨부 키의
        // orphan cleanup은 제거됨 — 발행 스냅샷/복제/보관함이 계속 참조할 수 있다.
        const promotedQuestions = await promoteNoticeAttachments(
          await promoteSurveyImages(questionChanges.upserted),
        );

        // 업서트 대상의 이전 행을 읽어 old 측에, 새 콘텐츠를 new 측에 넣는다
        const oldUpsertedRows = await tx
          .select()
          .from(questions)
          .where(
            inArray(
              questions.id,
              promotedQuestions.map((q) => q.id),
            ),
          );
        addKeys(oldContentKeys, oldUpsertedRows);
        addKeys(newContentKeys, promotedQuestions);

        const questionValues = promotedQuestions.map((question) => ({
          id: question.id,
          surveyId,
          groupId: question.groupId || null,
          type: question.type,
          title: question.title,
          description: question.description,
          required: question.required,
          requiredMessage: question.requiredMessage ?? null,
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
          optionsAlign: question.optionsAlign,
          mobileOptionsColumns: question.mobileOptionsColumns,
          rankingConfig: question.rankingConfig as NewQuestion['rankingConfig'],
          choiceGroups: question.choiceGroups as NewQuestion['choiceGroups'],
          minSelections: question.minSelections,
          maxSelections: question.maxSelections,
          noticeContent: question.noticeContent,
          noticeBgColor: question.noticeBgColor,
          requiresAcknowledgment: question.requiresAcknowledgment,
          placeholder: question.placeholder,
          tableValidationRules:
            question.tableValidationRules as NewQuestion['tableValidationRules'],
          numberFormat: question.numberFormat as NewQuestion['numberFormat'],
          sumConstraints: question.sumConstraints as NewQuestion['sumConstraints'],
          dynamicRowConfigs:
            question.dynamicRowConfigs as NewQuestion['dynamicRowConfigs'],
          hideColumnLabels: question.hideColumnLabels,
          exportCellOrder: question.exportCellOrder ?? null,
          mobileOriginalTable: question.mobileOriginalTable,
          mobileTableDisplayMode: question.mobileTableDisplayMode,
          mobileDrilldownOmitLeadingColumns: question.mobileDrilldownOmitLeadingColumns,
          mobileDrilldownRepeatHeaderStartRow: question.mobileDrilldownRepeatHeaderStartRow,
          mobileDrilldownRepeatHeaderEndRow: question.mobileDrilldownRepeatHeaderEndRow,
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
          piiEncrypted: question.piiEncrypted ?? false,
          pageBreakBefore: question.pageBreakBefore,
          answerQuoteEnabled: question.answerQuoteEnabled,
          answerQuoteName: question.answerQuoteName,
          answerQuoteText: question.answerQuoteText,
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
              requiredMessage: sql`excluded.required_message`,
              order: sql`excluded.order`,
              options: sql`excluded.options`,
              selectLevels: sql`excluded.select_levels`,
              tableTitle: sql`excluded.table_title`,
              tableColumns: sql`excluded.table_columns`,
              tableRowsData: sql`excluded.table_rows_data`,
              tableHeaderGrid: sql`excluded.table_header_grid`,
              allowOtherOption: sql`excluded.allow_other_option`,
              optionsColumns: sql`excluded.options_columns`,
              optionsAlign: sql`excluded.options_align`,
              mobileOptionsColumns: sql`excluded.mobile_options_columns`,
              rankingConfig: sql`excluded.ranking_config`,
              choiceGroups: sql`excluded.choice_groups`,
              minSelections: sql`excluded.min_selections`,
              maxSelections: sql`excluded.max_selections`,
              noticeContent: sql`excluded.notice_content`,
              noticeBgColor: sql`excluded.notice_bg_color`,
              requiresAcknowledgment: sql`excluded.requires_acknowledgment`,
              placeholder: sql`excluded.placeholder`,
              tableValidationRules: sql`excluded.table_validation_rules`,
              numberFormat: sql`excluded.number_format`,
              sumConstraints: sql`excluded.sum_constraints`,
              dynamicRowConfigs: sql`excluded.dynamic_row_config`,
              hideColumnLabels: sql`excluded.hide_column_labels`,
              exportCellOrder: sql`excluded.export_cell_order`,
              mobileOriginalTable: sql`excluded.mobile_original_table`,
              mobileTableDisplayMode: sql`excluded.mobile_table_display_mode`,
              mobileDrilldownOmitLeadingColumns: sql`excluded.mobile_drilldown_omit_leading_columns`,
              mobileDrilldownRepeatHeaderStartRow:
                sql`excluded.mobile_drilldown_repeat_header_start_row`,
              mobileDrilldownRepeatHeaderEndRow:
                sql`excluded.mobile_drilldown_repeat_header_end_row`,
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
              piiEncrypted: sql`excluded.pii_encrypted`,
              pageBreakBefore: sql`excluded.page_break_before`,
              answerQuoteEnabled: sql`excluded.answer_quote_enabled`,
              answerQuoteName: sql`excluded.answer_quote_name`,
              answerQuoteText: sql`excluded.answer_quote_text`,
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

    // 저장 diff 마무리 — payload 범위에서 빠진 키 등록 + 재등장 키 부활 취소 (같은 tx)
    await collectSaveDiffAndRevival(tx, {
      oldKeys: [...oldContentKeys],
      newKeys: [...newContentKeys],
      reason: `설문 저장: ${surveyId}`,
    });

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

    // 저장 diff 수집 — 전체 저장은 콘텐츠 전량이 payload 이므로 old 전량과 비교한다
    const oldContentKeys = new Set<string>();
    const newContentKeys = new Set<string>();
    if (existingSurvey) {
      addKeys(oldContentKeys, {
        responseHeader: existingSurvey.responseHeader,
        description: existingSurvey.description,
        thankYouMessage: existingSurvey.thankYouMessage,
      });
    }
    addKeys(newContentKeys, {
      responseHeader: promotedResponseHeader ?? null,
      description: surveyData.description,
      thankYouMessage: surveyData.settings.thankYouMessage,
    });

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
        piiRetentionUntil: surveyData.settings.piiRetentionUntil
          ? retentionDateToTimestamp(surveyData.settings.piiRetentionUntil)
          : null,
        maxResponses: surveyData.settings.maxResponses ?? null,
        thankYouMessage: surveyData.settings.thankYouMessage,
        requireInviteToken: surveyData.settings.requireInviteToken ?? false,
        forceWideLayout: surveyData.settings.forceWideLayout ?? false,
        priorWaveLabel: normalizePriorWaveLabel(surveyData.settings.priorWaveLabel),
        changeConfirmEnabled: surveyData.settings.changeConfirmEnabled ?? false,
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
        piiRetentionUntil: surveyData.settings.piiRetentionUntil
          ? retentionDateToTimestamp(surveyData.settings.piiRetentionUntil)
          : null,
        maxResponses: surveyData.settings.maxResponses ?? null,
        thankYouMessage: surveyData.settings.thankYouMessage,
        requireInviteToken: surveyData.settings.requireInviteToken ?? false,
        forceWideLayout: surveyData.settings.forceWideLayout ?? false,
        priorWaveLabel: normalizePriorWaveLabel(surveyData.settings.priorWaveLabel),
        changeConfirmEnabled: surveyData.settings.changeConfirmEnabled ?? false,
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
          })
        : [];
      // 전체 저장 diff 의 old 측 — 이번 저장으로 삭제되는 질문 포함 전량
      addKeys(oldContentKeys, existingQuestions);

      const newQuestionIds = new Set(surveyData.questions.map((q) => q.id));
      const questionIdsToRemove = existingQuestions
        .filter((q) => !newQuestionIds.has(q.id))
        .map((q) => q.id);

      if (questionIdsToRemove.length > 0) {
        // 질문 삭제 시 R2 이미지/영구 첨부 키는 지우지 않는다(사유는 saveSurveyDiff 3a 참조).
        await tx.delete(questions).where(inArray(questions.id, questionIdsToRemove));
      }

      if (surveyData.questions.length > 0) {
        // tmp/survey/ 이미지를 영구 prefix로 promote (R2 copy + URL 치환, 원본 tmp 는 lifecycle 위임)
        // tmp/notice-attachment/ 첨부도 영구 prefix로 promote. 이전 영구 첨부 키의
        // orphan cleanup은 제거됨 — 발행 스냅샷/복제/보관함이 계속 참조할 수 있다.
        const promotedQuestions = await promoteNoticeAttachments(
          await promoteSurveyImages(surveyData.questions),
        );
        addKeys(newContentKeys, promotedQuestions);

        const questionValues = promotedQuestions.map((question) => ({
          id: question.id,
          surveyId,
          groupId: question.groupId || null,
          type: question.type,
          title: question.title,
          description: question.description,
          required: question.required,
          requiredMessage: question.requiredMessage ?? null,
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
          optionsAlign: question.optionsAlign,
          mobileOptionsColumns: question.mobileOptionsColumns,
          rankingConfig: question.rankingConfig as NewQuestion['rankingConfig'],
          choiceGroups: question.choiceGroups as NewQuestion['choiceGroups'],
          minSelections: question.minSelections,
          maxSelections: question.maxSelections,
          noticeContent: question.noticeContent,
          noticeBgColor: question.noticeBgColor,
          requiresAcknowledgment: question.requiresAcknowledgment,
          placeholder: question.placeholder,
          tableValidationRules:
            question.tableValidationRules as NewQuestion['tableValidationRules'],
          numberFormat: question.numberFormat as NewQuestion['numberFormat'],
          sumConstraints: question.sumConstraints as NewQuestion['sumConstraints'],
          dynamicRowConfigs:
            question.dynamicRowConfigs as NewQuestion['dynamicRowConfigs'],
          hideColumnLabels: question.hideColumnLabels,
          exportCellOrder: question.exportCellOrder ?? null,
          mobileOriginalTable: question.mobileOriginalTable,
          mobileTableDisplayMode: question.mobileTableDisplayMode,
          mobileDrilldownOmitLeadingColumns: question.mobileDrilldownOmitLeadingColumns,
          mobileDrilldownRepeatHeaderStartRow: question.mobileDrilldownRepeatHeaderStartRow,
          mobileDrilldownRepeatHeaderEndRow: question.mobileDrilldownRepeatHeaderEndRow,
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
          piiEncrypted: question.piiEncrypted ?? false,
          pageBreakBefore: question.pageBreakBefore,
          answerQuoteEnabled: question.answerQuoteEnabled,
          answerQuoteName: question.answerQuoteName,
          answerQuoteText: question.answerQuoteText,
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
              requiredMessage: sql`excluded.required_message`,
              order: sql`excluded.order`,
              options: sql`excluded.options`,
              selectLevels: sql`excluded.select_levels`,
              tableTitle: sql`excluded.table_title`,
              tableColumns: sql`excluded.table_columns`,
              tableRowsData: sql`excluded.table_rows_data`,
              tableHeaderGrid: sql`excluded.table_header_grid`,
              allowOtherOption: sql`excluded.allow_other_option`,
              optionsColumns: sql`excluded.options_columns`,
              optionsAlign: sql`excluded.options_align`,
              mobileOptionsColumns: sql`excluded.mobile_options_columns`,
              rankingConfig: sql`excluded.ranking_config`,
              choiceGroups: sql`excluded.choice_groups`,
              minSelections: sql`excluded.min_selections`,
              maxSelections: sql`excluded.max_selections`,
              noticeContent: sql`excluded.notice_content`,
              noticeBgColor: sql`excluded.notice_bg_color`,
              requiresAcknowledgment: sql`excluded.requires_acknowledgment`,
              placeholder: sql`excluded.placeholder`,
              tableValidationRules: sql`excluded.table_validation_rules`,
              numberFormat: sql`excluded.number_format`,
              sumConstraints: sql`excluded.sum_constraints`,
              dynamicRowConfigs: sql`excluded.dynamic_row_config`,
              hideColumnLabels: sql`excluded.hide_column_labels`,
              exportCellOrder: sql`excluded.export_cell_order`,
              mobileOriginalTable: sql`excluded.mobile_original_table`,
              mobileTableDisplayMode: sql`excluded.mobile_table_display_mode`,
              mobileDrilldownOmitLeadingColumns: sql`excluded.mobile_drilldown_omit_leading_columns`,
              mobileDrilldownRepeatHeaderStartRow:
                sql`excluded.mobile_drilldown_repeat_header_start_row`,
              mobileDrilldownRepeatHeaderEndRow:
                sql`excluded.mobile_drilldown_repeat_header_end_row`,
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
              piiEncrypted: sql`excluded.pii_encrypted`,
              pageBreakBefore: sql`excluded.page_break_before`,
              answerQuoteEnabled: sql`excluded.answer_quote_enabled`,
              answerQuoteName: sql`excluded.answer_quote_name`,
              answerQuoteText: sql`excluded.answer_quote_text`,
              updatedAt: sql`excluded.updated_at`,
            } satisfies CompleteQuestionWrite,
          });
      }
    }

    // 저장 diff 마무리 — 빠진 키 등록 + 재등장 키 부활 취소 (같은 tx).
    // 신규 생성(existingSurvey 없음)은 old 가 비어 등록이 일어나지 않는다.
    await collectSaveDiffAndRevival(tx, {
      oldKeys: [...oldContentKeys],
      newKeys: [...newContentKeys],
      reason: `설문 전체 저장: ${surveyId}`,
    });

    return { surveyId };
  });
}
