import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { getQuestionsBySurvey } from '@/data/surveys';
import { db } from '@/db';
import { NewQuestion, questions } from '@/db/schema';
import {
  PERSISTED_QUESTION_FIELDS,
  type CompleteQuestionWrite,
} from '@/db/schema/question-persisted-fields';
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

  const newQuestion = {
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
    allowOtherOption: data.allowOtherOption,
    optionsColumns: data.optionsColumns,
    optionsAlign: data.optionsAlign,
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
    hideTitle: data.hideTitle,
    pageBreakBefore: data.pageBreakBefore,
    rankingConfig: data.rankingConfig as NewQuestion['rankingConfig'],
    choiceGroups: data.choiceGroups as NewQuestion['choiceGroups'],
    questionCode: data.questionCode,
    isCustomSpssVarName: data.isCustomSpssVarName,
    exportLabel: data.exportLabel,
    spssVarType: data.spssVarType,
    spssMeasure: data.spssMeasure,
  } satisfies CompleteQuestionWrite & NewQuestion;

  // tmp/survey/ 이미지를 영구 prefix로 promote (R2 move + URL 치환)
  const [questionToInsert] = await promoteSurveyImages([newQuestion as PromotableQuestion]);

  const [question] = await db
    .insert(questions)
    .values(questionToInsert as NewQuestion)
    .returning();

  if (!question) throw new Error('질문 생성에 실패했습니다.');
  return question as QuestionRow;
}

/**
 * 질문 업데이트 — 영속 필드 SSOT 순회로 허용 필드만 추출(불변식 A).
 *
 * WS-2 IDOR 봉인: WHERE 에 surveyId 를 함께 걸어, 다른 설문 소속 질문은
 * 영향 0행이 되어 update 가 실패한다(procedure 가 NOT_FOUND 로 매핑).
 */
export async function updateQuestion(
  questionId: string,
  surveyId: string,
  data: UpdateQuestionData,
): Promise<QuestionRow> {
  // PERSISTED_QUESTION_FIELDS 순회가 화이트리스트다 (id, surveyId, createdAt 등 변경 방지).
  // 신규 컬럼이 SSOT 에 등재되면 아래 data[field] 인덱스 접근이 UpdateQuestionData
  // 누락을 컴파일 에러로 호명한다 — 수동 if-체인의 silent drop(H17 류) 벡터 봉인.
  const allowed: Partial<NewQuestion> = { updatedAt: new Date() };
  for (const field of PERSISTED_QUESTION_FIELDS) {
    if (field === 'type') continue; // 생성 후 불변 — 패치 대상이 아니다 (UpdateQuestionData 에도 부재)
    const value = data[field];
    if (value !== undefined) {
      // 키 상관 할당(field ↔ value 타입 짝)은 TS 가 추적하지 못한다 — 키 집합은
      // 위 인덱스 접근이, 값 타입은 zod(UpdateQuestionData)가 보증하므로 여기만 좁힌다.
      (allowed as Record<string, unknown>)[field] = value;
    }
  }

  // tmp/survey/ 이미지를 영구 prefix로 promote (R2 move + URL 치환)
  const [allowedToUpdate] = await promoteSurveyImages([allowed as PromotableQuestion]);

  const [updated] = await db
    .update(questions)
    .set(allowedToUpdate as Partial<NewQuestion>)
    .where(and(eq(questions.id, questionId), eq(questions.surveyId, surveyId)))
    .returning();

  if (!updated) throw new Error('질문 업데이트에 실패했습니다.');
  return updated as QuestionRow;
}

/**
 * 질문 삭제 — 이미지 R2 cleanup(best-effort) 후 행 삭제.
 *
 * WS-2 IDOR 봉인: 조회/삭제 모두 surveyId 스코프로 한정한다. 다른 설문 소속이면
 * 사전 조회가 0행이라 이미지 cleanup 도, 삭제도 일어나지 않는다.
 */
export async function deleteQuestion(
  questionId: string,
  surveyId: string,
): Promise<{ ok: true }> {
  const question = await db.query.questions.findFirst({
    where: and(eq(questions.id, questionId), eq(questions.surveyId, surveyId)),
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

  await db
    .delete(questions)
    .where(and(eq(questions.id, questionId), eq(questions.surveyId, surveyId)));
  return { ok: true as const };
}

/**
 * [최적화] 질문 순서 변경 — order 는 1-based(index + 1). 변경된 행만 update.
 *
 * WS-2 IDOR 봉인: 조회를 surveyId 스코프로 한정하고, 유효한 questionId 가 전부
 * 그 설문 소속인지 검증한다. 하나라도 타 설문(또는 미존재) id 가 섞이면 거부해
 * 타 설문 질문 order 를 흔드는 경로를 차단한다. order 갱신 WHERE 에도 surveyId 를 건다.
 */
export async function reorderQuestions(
  questionIds: string[],
  surveyId: string,
): Promise<{ ok: true }> {
  const validQuestionIds = questionIds.filter((id) => isValidUUID(id));
  if (validQuestionIds.length === 0) return { ok: true as const };

  const currentQuestions = await db.query.questions.findMany({
    where: and(eq(questions.surveyId, surveyId), inArray(questions.id, validQuestionIds)),
    columns: {
      id: true,
      order: true,
    },
  });

  const currentOrderMap = new Map(currentQuestions.map((q) => [q.id, q.order]));

  // 소속 검증: 유효 id 전부가 해당 설문에서 조회되어야 한다. 누락분이 있으면
  // 타 설문 소속(또는 미존재) id 가 섞인 것이므로 전체 reorder 를 거부한다.
  const allBelong = validQuestionIds.every((id) => currentOrderMap.has(id));
  if (!allBelong) {
    throw new Error('다른 설문 소속 질문이 reorder 요청에 포함되어 거부되었습니다.');
  }

  const updates: Promise<unknown>[] = [];

  validQuestionIds.forEach((id, index) => {
    const newOrder = index + 1;
    const currentOrder = currentOrderMap.get(id);

    if (currentOrder !== newOrder) {
      updates.push(
        db
          .update(questions)
          .set({ order: newOrder, updatedAt: new Date() })
          .where(and(eq(questions.id, id), eq(questions.surveyId, surveyId))),
      );
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
  }

  return { ok: true as const };
}
