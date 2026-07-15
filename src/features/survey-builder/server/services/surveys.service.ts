import 'server-only';

import { eq } from 'drizzle-orm';

import { getSurveyById } from '@/data/surveys';
import type { CompleteQuestionWrite } from '@/db/schema/question-persisted-fields';
import { db } from '@/db';
import {
  NewQuestion,
  NewQuestionGroup,
  NewSurvey,
  questionGroups,
  questions,
  surveys,
} from '@/db/schema';
import { extractImageUrlsFromQuestions } from '@/lib/image-extractor';
import { deleteImagesFromR2Server } from '@/lib/image-utils-server';
import { promoteSurveyResponseHeader } from '@/lib/survey/survey-image-promote';
import { generateId } from '@/lib/utils';
import type { Question } from '@/types/survey';
import { stripOptionCodes } from '@/utils/option-code-generator';

import type {
  CreateSurveyInput,
  EnsureSurveyInDbInput,
  EnsureSurveyResult,
  SurveyIdInput,
  SurveyRow,
  UpdateSurveyInput,
} from '../../domain/survey';

// ========================
// 설문 CRUD 서비스
// ========================
//
// 인증은 authed 미들웨어가 담당(requireAuth 제거). 캐시 갱신(revalidatePath)은
// 소비처 query invalidation(use-survey-sync)으로 대체한다.

// 설문이 DB에 존재하는지 확인하고, 없으면 최소한의 레코드를 생성 (idempotent)
export async function ensureSurveyInDb(
  input: EnsureSurveyInDbInput,
): Promise<EnsureSurveyResult> {
  const existing = await db.query.surveys.findFirst({
    where: eq(surveys.id, input.id),
    columns: { id: true },
  });

  if (existing) return { surveyId: input.id, created: false };

  await db.insert(surveys).values({
    id: input.id,
    title: input.title,
    privateToken: input.privateToken,
    isPublic: input.settings.isPublic ?? true,
    allowMultipleResponses: input.settings.allowMultipleResponses ?? false,
    showProgressBar: input.settings.showProgressBar ?? true,
    shuffleQuestions: input.settings.shuffleQuestions ?? false,
    requireLogin: input.settings.requireLogin ?? false,
    thankYouMessage: input.settings.thankYouMessage ?? '응답해주셔서 감사합니다!',
    responseHeader: (await promoteSurveyResponseHeader(input.settings.responseHeader)) ?? null,
  });

  return { surveyId: input.id, created: true };
}

// 설문 생성
export async function createSurvey(data: CreateSurveyInput): Promise<SurveyRow> {
  const newSurvey: NewSurvey = {
    title: data.title,
    description: data.description,
    slug: data.slug,
    isPublic: data.isPublic ?? true,
    allowMultipleResponses: data.settings?.allowMultipleResponses ?? false,
    showProgressBar: data.settings?.showProgressBar ?? true,
    shuffleQuestions: data.settings?.shuffleQuestions ?? false,
    requireLogin: data.settings?.requireLogin ?? false,
    endDate: data.settings?.endDate ? new Date(data.settings.endDate) : null,
    maxResponses: data.settings?.maxResponses ?? null,
    thankYouMessage: data.settings?.thankYouMessage ?? '응답해주셔서 감사합니다!',
    responseHeader: (await promoteSurveyResponseHeader(data.settings?.responseHeader)) ?? null,
  };

  const [survey] = await db.insert(surveys).values(newSurvey).returning();
  if (!survey) throw new Error('createSurvey: 설문 생성 실패');

  return survey;
}

// 설문 업데이트
export async function updateSurvey(input: UpdateSurveyInput): Promise<SurveyRow> {
  const { surveyId, data } = input;

  // responseHeader 가 실려 온 경우에만 로고 tmp-to-permanent 승격 후 set(미포함 시 기존 값 보존)
  const dataToUpdate =
    data.responseHeader === undefined
      ? data
      : {
          ...data,
          responseHeader: await promoteSurveyResponseHeader(data.responseHeader),
        };

  const [updated] = await db
    .update(surveys)
    .set({
      ...dataToUpdate,
      updatedAt: new Date(),
    })
    .where(eq(surveys.id, surveyId))
    .returning();
  if (!updated) throw new Error('updateSurvey: 설문 업데이트 실패');

  return updated;
}

// 설문 삭제
export async function deleteSurvey(input: SurveyIdInput): Promise<void> {
  const { surveyId } = input;

  const surveyQuestions = await db.query.questions.findMany({
    where: eq(questions.surveyId, surveyId),
  });

  if (surveyQuestions.length > 0) {
    const allImages = extractImageUrlsFromQuestions(surveyQuestions as Question[]);
    if (allImages.length > 0) {
      try {
        await deleteImagesFromR2Server(allImages);
      } catch (error) {
        console.error('설문 삭제 시 이미지 삭제 실패:', error);
      }
    }
  }

  await db.delete(surveys).where(eq(surveys.id, surveyId));
}

// 설문 복제
export async function duplicateSurvey(
  input: SurveyIdInput,
): Promise<SurveyRow | null> {
  const { surveyId } = input;

  const original = await getSurveyById(surveyId);
  if (!original) return null;

  return await db.transaction(async (tx) => {
    const originalGroups = await tx.query.questionGroups.findMany({
      where: eq(questionGroups.surveyId, surveyId),
      orderBy: [questionGroups.order],
    });

    const originalQuestions = await tx.query.questions.findMany({
      where: eq(questions.surveyId, surveyId),
      orderBy: [questions.order],
    });

    const newSurveyRows = await tx
      .insert(surveys)
      .values({
        title: `${original.title} (복사본)`,
        description: original.description,
        isPublic: original.isPublic,
        allowMultipleResponses: original.allowMultipleResponses,
        showProgressBar: original.showProgressBar,
        shuffleQuestions: original.shuffleQuestions,
        requireLogin: original.requireLogin,
        endDate: original.endDate,
        piiRetentionUntil: original.piiRetentionUntil,
        maxResponses: original.maxResponses,
        thankYouMessage: original.thankYouMessage,
        responseHeader: original.responseHeader ?? null,
      })
      .returning();
    const newSurvey = newSurveyRows[0];
    if (!newSurvey) throw new Error('copySurvey: 새 설문 생성 실패');

    // 그룹 정렬 (상위 그룹부터 하위 그룹 순으로)
    const sortedGroups: typeof originalGroups = [];
    if (originalGroups.length > 0) {
      const processedGroupIds = new Set<string>();
      const topLevelGroups = originalGroups
        .filter((g) => !g.parentGroupId)
        .sort((a, b) => a.order - b.order);
      sortedGroups.push(...topLevelGroups);
      topLevelGroups.forEach((g) => processedGroupIds.add(g.id));

      const addSubGroups = (parentId: string) => {
        const subGroups = originalGroups
          .filter((g) => g.parentGroupId === parentId && !processedGroupIds.has(g.id))
          .sort((a, b) => a.order - b.order);

        subGroups.forEach((g) => {
          sortedGroups.push(g);
          processedGroupIds.add(g.id);
          addSubGroups(g.id);
        });
      };

      topLevelGroups.forEach((group) => {
        addSubGroups(group.id);
      });
    }

    // 그룹 ID 매핑 및 데이터 준비
    const groupIdMap = new Map<string, string>();
    const newGroupsData = sortedGroups.map((group) => {
      const newGroupId = generateId();
      groupIdMap.set(group.id, newGroupId);
      return {
        id: newGroupId,
        surveyId: newSurvey.id,
        name: group.name,
        description: group.description,
        order: group.order,
        parentGroupId: group.parentGroupId ? groupIdMap.get(group.parentGroupId) : null,
        color: group.color,
        collapsed: group.collapsed,
        nameDesign: group.nameDesign as NewQuestionGroup['nameDesign'],
        displayCondition: group.displayCondition as NewQuestionGroup['displayCondition'],
      };
    });

    if (newGroupsData.length > 0) {
      await tx.insert(questionGroups).values(newGroupsData);
    }

    // 질문 데이터 준비
    const questionIdMap = new Map<string, string>();
    const newQuestionsData = originalQuestions.map((question) => {
      const newQuestionId = generateId();
      questionIdMap.set(question.id, newQuestionId);
      return {
        id: newQuestionId,
        surveyId: newSurvey.id,
        groupId: question.groupId ? groupIdMap.get(question.groupId) : null,
        type: question.type,
        title: question.title,
        description: question.description,
        required: question.required,
        order: question.order,
        options: (question.options ? stripOptionCodes(question.options) : question.options) as NewQuestion['options'],
        selectLevels: question.selectLevels as NewQuestion['selectLevels'],
        tableTitle: question.tableTitle,
        tableColumns: question.tableColumns as NewQuestion['tableColumns'],
        tableRowsData: question.tableRowsData as NewQuestion['tableRowsData'],
        tableHeaderGrid: question.tableHeaderGrid as NewQuestion['tableHeaderGrid'],
        allowOtherOption: question.allowOtherOption,
        optionsColumns: question.optionsColumns,
        optionsAlign: question.optionsAlign,
        minSelections: question.minSelections,
        maxSelections: question.maxSelections,
        rankingConfig: question.rankingConfig as NewQuestion['rankingConfig'],
        choiceGroups: question.choiceGroups as NewQuestion['choiceGroups'],
        noticeContent: question.noticeContent,
        requiresAcknowledgment: question.requiresAcknowledgment,
        placeholder: question.placeholder,
        defaultValueTemplate: question.defaultValueTemplate,
        inputType: question.inputType,
        emptyDefault: question.emptyDefault,
        piiEncrypted: question.piiEncrypted,
        questionCode: question.questionCode,
        isCustomSpssVarName: question.isCustomSpssVarName,
        exportLabel: question.exportLabel,
        spssVarType: question.spssVarType,
        spssMeasure: question.spssMeasure,
        tableValidationRules: question.tableValidationRules as NewQuestion['tableValidationRules'],
        dynamicRowConfigs: question.dynamicRowConfigs as NewQuestion['dynamicRowConfigs'],
        hideColumnLabels: question.hideColumnLabels,
        hideTitle: question.hideTitle,
        pageBreakBefore: question.pageBreakBefore,
        displayCondition: question.displayCondition as NewQuestion['displayCondition'],
      } satisfies CompleteQuestionWrite;
    });

    if (newQuestionsData.length > 0) {
      await tx.insert(questions).values(newQuestionsData);
    }

    return newSurvey;
  });
}
