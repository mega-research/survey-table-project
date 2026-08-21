import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { getQuestionsBySurvey } from '@/data/surveys';
import { db } from '@/db';
import { NewQuestion, questions } from '@/db/schema';
import {
  PERSISTED_QUESTION_FIELDS,
  type CompleteQuestionWrite,
} from '@/db/schema/question-persisted-fields';
import { registerDeletionCandidates } from '@/server/storage-lifecycle/deletion-queue.server';
import { extractR2KeysFromJsonbValue } from '@/server/storage-lifecycle/key-extract';
import { collectFieldLimitedSaveDiff } from '@/server/storage-lifecycle/save-diff-collector.server';
import { promoteNoticeAttachments } from '@/lib/survey/notice-attachment-promote';
import { promoteSurveyImages, type PromotableQuestion } from '@/lib/survey/survey-image-promote';
import { generateId, isValidUUID } from '@/lib/utils';

import type {
  CreateQuestionInput,
  QuestionRow,
  UpdateQuestionData,
} from '../domain/question';

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
    requiredMessage: data.requiredMessage ?? null,
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
    mobileOptionsColumns: data.mobileOptionsColumns,
    minSelections: data.minSelections,
    maxSelections: data.maxSelections,
    noticeContent: data.noticeContent,
    requiresAcknowledgment: data.requiresAcknowledgment,
    placeholder: data.placeholder,
    defaultValueTemplate: data.defaultValueTemplate,
    inputType: data.inputType,
    emptyDefault: data.emptyDefault,
    piiEncrypted: data.piiEncrypted,
    tableValidationRules: data.tableValidationRules as NewQuestion['tableValidationRules'],
    numberFormat: data.numberFormat as NewQuestion['numberFormat'],
    sumConstraints: data.sumConstraints as NewQuestion['sumConstraints'],
    displayCondition: data.displayCondition as NewQuestion['displayCondition'],
    dynamicRowConfigs: data.dynamicRowConfigs as NewQuestion['dynamicRowConfigs'],
    hideColumnLabels: data.hideColumnLabels,
    exportCellOrder: data.exportCellOrder ?? null,
    mobileOriginalTable: data.mobileOriginalTable,
    mobileTableDisplayMode: data.mobileTableDisplayMode,
    mobileDrilldownOmitLeadingColumns: data.mobileDrilldownOmitLeadingColumns,
    mobileDrilldownRepeatHeaderStartRow: data.mobileDrilldownRepeatHeaderStartRow,
    mobileDrilldownRepeatHeaderEndRow: data.mobileDrilldownRepeatHeaderEndRow,
    hideTitle: data.hideTitle,
    pageBreakBefore: data.pageBreakBefore,
    rankingConfig: data.rankingConfig as NewQuestion['rankingConfig'],
    choiceGroups: data.choiceGroups as NewQuestion['choiceGroups'],
    questionCode: data.questionCode,
    isCustomSpssVarName: data.isCustomSpssVarName,
    exportLabel: data.exportLabel,
    spssVarType: data.spssVarType,
    spssMeasure: data.spssMeasure,
    answerQuoteEnabled: data.answerQuoteEnabled,
    answerQuoteName: data.answerQuoteName,
    answerQuoteText: data.answerQuoteText,
  } satisfies CompleteQuestionWrite & NewQuestion;

  // tmp/survey/ 이미지를 영구 prefix로 promote (R2 copy + URL 치환, 원본 tmp 는 lifecycle 위임)
  // tmp/notice-attachment/ 첨부도 영구 prefix로 promote (survey-save 와 동일 체이닝)
  const [questionToInsert] = await promoteNoticeAttachments(
    await promoteSurveyImages([newQuestion as PromotableQuestion]),
  );

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

  // tmp/survey/ 이미지를 영구 prefix로 promote (R2 copy + URL 치환, 원본 tmp 는 lifecycle 위임)
  // tmp/notice-attachment/ 첨부도 영구 prefix로 promote. 부분 patch 에서 noticeContent 가
  // payload 에 없으면 promoteNoticeAttachments 는 tmp URL 0건으로 no-op (안전).
  const [allowedToUpdate] = await promoteNoticeAttachments(
    await promoteSurveyImages([allowed as PromotableQuestion]),
  );

  // 저장 전 행 콘텐츠 read → write → 저장 diff 등록·부활 취소를 같은 트랜잭션으로.
  // 비교는 payload 존재 필드에 한정 — 미포함 필드는 "빠짐"으로 오판하지 않는다.
  return db.transaction(async (tx) => {
    const [oldRow] = await tx
      .select()
      .from(questions)
      .where(and(eq(questions.id, questionId), eq(questions.surveyId, surveyId)));

    const [updated] = await tx
      .update(questions)
      .set(allowedToUpdate as Partial<NewQuestion>)
      .where(and(eq(questions.id, questionId), eq(questions.surveyId, surveyId)))
      .returning();

    if (!updated) throw new Error('질문 업데이트에 실패했습니다.');

    if (oldRow) {
      await collectFieldLimitedSaveDiff(tx, {
        oldRow,
        payloadRow: allowedToUpdate as Record<string, unknown>,
        reason: `질문 수정: ${oldRow.title || questionId}`,
      });
    }

    return updated as QuestionRow;
  });
}

/**
 * 질문 삭제 — surveyId 스코프 WHERE 로 행만 삭제. 이미지는 R2 에서 지우지 않는다
 * (발행 스냅샷·복제 설문·보관함이 같은 URL 을 참조할 수 있어 무확인 삭제 금지).
 *
 * WS-2 IDOR 봉인: 삭제 WHERE 에 surveyId 를 함께 걸어, 다른 설문 소속이면 영향 0행.
 */
export async function deleteQuestion(
  questionId: string,
  surveyId: string,
): Promise<{ ok: true }> {
  // 삭제 전 같은 트랜잭션에서 행 콘텐츠의 R2 키를 수집해 유예 삭제 큐에 등록
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(questions)
      .where(and(eq(questions.id, questionId), eq(questions.surveyId, surveyId)));
    if (row) {
      await registerDeletionCandidates(tx, {
        keys: extractR2KeysFromJsonbValue(row),
        source: 'question-delete',
        reason: `질문 삭제: ${row.title || questionId}`,
      });
    }
    await tx
      .delete(questions)
      .where(and(eq(questions.id, questionId), eq(questions.surveyId, surveyId)));
  });
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
