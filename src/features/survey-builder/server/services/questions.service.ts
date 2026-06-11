import 'server-only';

import { eq, inArray } from 'drizzle-orm';

import { getQuestionsBySurvey } from '@/data/surveys';
import { db } from '@/db';
import { NewQuestion, questions } from '@/db/schema';
import { extractImageUrlsFromQuestion } from '@/lib/image-extractor';
import { deleteImagesFromR2Server } from '@/lib/image-utils-server';
import { promoteSurveyImages, type PromotableQuestion } from '@/lib/survey/survey-image-promote';
import { generateId, isValidUUID } from '@/lib/utils';
import type { Question } from '@/types/survey';

import type {
  CreateQuestionInput,
  QuestionRow,
  UpdateQuestionData,
} from '../../domain/question';

// 원본: src/actions/question-actions.ts
// requireAuth/revalidatePath 는 procedure(authed) + 소비처 router.refresh 로 대체.
// explicit field set(불변식 A) / promote 체인(불변식 B) / reorder 1-based 보존.

/** 질문 생성 — 24필드 explicit whitelist set(spread 금지, 불변식 A). */
export async function createQuestion(data: CreateQuestionInput): Promise<QuestionRow> {
  const existingQuestions = await getQuestionsBySurvey(data.surveyId);

  const maxOrder =
    existingQuestions.length > 0 ? Math.max(...existingQuestions.map((q) => q.order)) : -1;

  const newQuestion: NewQuestion = {
    id: data.id || generateId(),
    surveyId: data.surveyId,
    groupId: data.groupId,
    type: data.type,
    title: data.title,
    description: data.description,
    required: data.required ?? false,
    order: data.order ?? maxOrder + 1,
    options: data.options as NewQuestion['options'],
    selectLevels: data.selectLevels as NewQuestion['selectLevels'],
    tableTitle: data.tableTitle,
    tableColumns: data.tableColumns as NewQuestion['tableColumns'],
    tableRowsData: data.tableRowsData as NewQuestion['tableRowsData'],
    tableHeaderGrid: data.tableHeaderGrid as NewQuestion['tableHeaderGrid'],
    imageUrl: data.imageUrl,
    videoUrl: data.videoUrl,
    allowOtherOption: data.allowOtherOption,
    optionsColumns: data.optionsColumns,
    minSelections: data.minSelections,
    maxSelections: data.maxSelections,
    noticeContent: data.noticeContent,
    requiresAcknowledgment: data.requiresAcknowledgment,
    placeholder: data.placeholder,
    defaultValueTemplate: data.defaultValueTemplate,
    inputType: data.inputType,
    emptyDefault: data.emptyDefault,
    tableValidationRules: data.tableValidationRules as NewQuestion['tableValidationRules'],
    displayCondition: data.displayCondition as NewQuestion['displayCondition'],
    dynamicRowConfigs: data.dynamicRowConfigs as NewQuestion['dynamicRowConfigs'],
    hideColumnLabels: data.hideColumnLabels,
    rankingConfig: data.rankingConfig as NewQuestion['rankingConfig'],
    choiceGroups: data.choiceGroups as NewQuestion['choiceGroups'],
    questionCode: data.questionCode,
    isCustomSpssVarName: data.isCustomSpssVarName,
    exportLabel: data.exportLabel,
    spssVarType: data.spssVarType,
    spssMeasure: data.spssMeasure,
  };

  // tmp/survey/ 이미지를 영구 prefix로 promote (R2 move + URL 치환)
  const [questionToInsert] = await promoteSurveyImages([newQuestion as PromotableQuestion]);

  const [question] = await db
    .insert(questions)
    .values(questionToInsert as NewQuestion)
    .returning();

  if (!question) throw new Error('질문 생성에 실패했습니다.');
  return question as QuestionRow;
}

/** 질문 업데이트 — 허용 필드만 화이트리스트로 추출(불변식 A). */
export async function updateQuestion(
  questionId: string,
  data: UpdateQuestionData,
): Promise<QuestionRow> {
  // 허용 필드만 추출 (id, surveyId, createdAt 등 변경 방지)
  const allowed: Partial<NewQuestion> = { updatedAt: new Date() };
  if (data.groupId !== undefined) allowed.groupId = data.groupId;
  if (data.type !== undefined) allowed.type = data.type;
  if (data.title !== undefined) allowed.title = data.title;
  if (data.description !== undefined) allowed.description = data.description;
  if (data.required !== undefined) allowed.required = data.required;
  if (data.order !== undefined) allowed.order = data.order;
  if (data.options !== undefined) allowed.options = data.options as NewQuestion['options'];
  if (data.selectLevels !== undefined) allowed.selectLevels = data.selectLevels as NewQuestion['selectLevels'];
  if (data.tableTitle !== undefined) allowed.tableTitle = data.tableTitle;
  if (data.tableColumns !== undefined) allowed.tableColumns = data.tableColumns as NewQuestion['tableColumns'];
  if (data.tableRowsData !== undefined) allowed.tableRowsData = data.tableRowsData as NewQuestion['tableRowsData'];
  if (data.tableHeaderGrid !== undefined) allowed.tableHeaderGrid = data.tableHeaderGrid as NewQuestion['tableHeaderGrid'];
  if (data.imageUrl !== undefined) allowed.imageUrl = data.imageUrl;
  if (data.videoUrl !== undefined) allowed.videoUrl = data.videoUrl;
  if (data.allowOtherOption !== undefined) allowed.allowOtherOption = data.allowOtherOption;
  if (data.optionsColumns !== undefined) allowed.optionsColumns = data.optionsColumns;
  if (data.minSelections !== undefined) allowed.minSelections = data.minSelections;
  if (data.maxSelections !== undefined) allowed.maxSelections = data.maxSelections;
  if (data.noticeContent !== undefined) allowed.noticeContent = data.noticeContent;
  if (data.requiresAcknowledgment !== undefined) allowed.requiresAcknowledgment = data.requiresAcknowledgment;
  if (data.placeholder !== undefined) allowed.placeholder = data.placeholder;
  if (data.defaultValueTemplate !== undefined) allowed.defaultValueTemplate = data.defaultValueTemplate;
  if (data.inputType !== undefined) allowed.inputType = data.inputType;
  if (data.emptyDefault !== undefined) allowed.emptyDefault = data.emptyDefault;
  if (data.tableValidationRules !== undefined) allowed.tableValidationRules = data.tableValidationRules as NewQuestion['tableValidationRules'];
  if (data.dynamicRowConfigs !== undefined) allowed.dynamicRowConfigs = data.dynamicRowConfigs as NewQuestion['dynamicRowConfigs'];
  if (data.hideColumnLabels !== undefined) allowed.hideColumnLabels = data.hideColumnLabels;
  if (data.rankingConfig !== undefined) allowed.rankingConfig = data.rankingConfig as NewQuestion['rankingConfig'];
  if (data.choiceGroups !== undefined) allowed.choiceGroups = data.choiceGroups as NewQuestion['choiceGroups'];
  if (data.displayCondition !== undefined) allowed.displayCondition = data.displayCondition as NewQuestion['displayCondition'];
  if (data.questionCode !== undefined) allowed.questionCode = data.questionCode;
  if (data.isCustomSpssVarName !== undefined) allowed.isCustomSpssVarName = data.isCustomSpssVarName;
  if (data.exportLabel !== undefined) allowed.exportLabel = data.exportLabel;
  if (data.spssVarType !== undefined) allowed.spssVarType = data.spssVarType;
  if (data.spssMeasure !== undefined) allowed.spssMeasure = data.spssMeasure;

  // tmp/survey/ 이미지를 영구 prefix로 promote (R2 move + URL 치환)
  const [allowedToUpdate] = await promoteSurveyImages([allowed as PromotableQuestion]);

  const [updated] = await db
    .update(questions)
    .set(allowedToUpdate as Partial<NewQuestion>)
    .where(eq(questions.id, questionId))
    .returning();

  if (!updated) throw new Error('질문 업데이트에 실패했습니다.');
  return updated as QuestionRow;
}

/** 질문 삭제 — 이미지 R2 cleanup(best-effort) 후 행 삭제. */
export async function deleteQuestion(questionId: string): Promise<{ ok: true }> {
  const question = await db.query.questions.findFirst({
    where: eq(questions.id, questionId),
  });

  if (question) {
    const images = extractImageUrlsFromQuestion(question as Question);
    if (images.length > 0) {
      try {
        await deleteImagesFromR2Server(images);
      } catch (error) {
        console.error('질문 삭제 시 이미지 삭제 실패:', error);
      }
    }
  }

  await db.delete(questions).where(eq(questions.id, questionId));
  return { ok: true as const };
}

/** [최적화] 질문 순서 변경 — order 는 1-based(index + 1). 변경된 행만 update. */
export async function reorderQuestions(questionIds: string[]): Promise<{ ok: true }> {
  const validQuestionIds = questionIds.filter((id) => isValidUUID(id));
  if (validQuestionIds.length === 0) return { ok: true as const };

  const currentQuestions = await db.query.questions.findMany({
    where: inArray(questions.id, validQuestionIds),
    columns: {
      id: true,
      order: true,
    },
  });

  const currentOrderMap = new Map(currentQuestions.map((q) => [q.id, q.order]));
  const updates: Promise<unknown>[] = [];

  validQuestionIds.forEach((id, index) => {
    const newOrder = index + 1;
    const currentOrder = currentOrderMap.get(id);

    if (currentOrder !== newOrder) {
      updates.push(
        db
          .update(questions)
          .set({ order: newOrder, updatedAt: new Date() })
          .where(eq(questions.id, id)),
      );
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
  }

  return { ok: true as const };
}
