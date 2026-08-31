import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { nextOrderAfter, toAnchorSnapshot } from '@/lib/survey-document/anchor-row';
import {
  questionGroups,
  questions,
  surveyDocumentAnchors,
  surveyDocuments,
} from '@/db/schema';

import type {
  CreateSurveyAnchorInput,
  ListSurveyAnchorsInput,
  RemoveSurveyAnchorInput,
  SurveyAnchor,
} from '../../domain/survey-anchor';

export class SurveyAnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SurveyAnchorError';
  }
}

/** 대상 종류 파생은 공용 매퍼(anchor-row) 하나에만 있다. */
function toAnchor(row: typeof surveyDocumentAnchors.$inferSelect): SurveyAnchor {
  const snapshot = toAnchorSnapshot(row);
  return {
    id: row.id,
    order: row.order,
    ...snapshot,
    documentId: row.documentId,
  };
}

export async function listSurveyAnchors(
  input: ListSurveyAnchorsInput,
): Promise<SurveyAnchor[]> {
  const rows = await db
    .select()
    .from(surveyDocumentAnchors)
    .where(eq(surveyDocumentAnchors.surveyId, input.surveyId))
    .orderBy(asc(surveyDocumentAnchors.order), asc(surveyDocumentAnchors.createdAt));
  return rows.map(toAnchor);
}

/**
 * 영역을 붙인다. 한 대상에 여러 개가 붙을 수 있다 — 그룹이 여러 쪽에 걸치면
 * 사각형 하나로 표현할 수 없기 때문이다.
 *
 * FK 는 대상이 **존재하는지**만 보장하고 그것이 이 설문의 것인지는 모른다.
 * 설문 경계는 여기서 확인한다 — 남의 설문 질문에 앵커를 붙이면 그 설문 발행
 * 스냅샷에 유령 사각형이 실린다.
 */
export async function createSurveyAnchor(
  input: CreateSurveyAnchorInput,
): Promise<SurveyAnchor> {
  const [document] = await db
    .select({ id: surveyDocuments.id, pageCount: surveyDocuments.pageCount })
    .from(surveyDocuments)
    .where(
      and(
        eq(surveyDocuments.id, input.documentId),
        eq(surveyDocuments.surveyId, input.surveyId),
      ),
    );
  if (!document) throw new SurveyAnchorError('조사표를 찾을 수 없습니다.');
  if (input.rect.page > document.pageCount) {
    throw new SurveyAnchorError('조사표에 없는 쪽입니다.');
  }

  if (input.ownerKind === 'question') {
    const [owner] = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(eq(questions.id, input.ownerId), eq(questions.surveyId, input.surveyId)));
    if (!owner) throw new SurveyAnchorError('이 설문의 질문이 아닙니다.');
  } else {
    const [owner] = await db
      .select({ id: questionGroups.id })
      .from(questionGroups)
      .where(
        and(
          eq(questionGroups.id, input.ownerId),
          eq(questionGroups.surveyId, input.surveyId),
        ),
      );
    if (!owner) throw new SurveyAnchorError('이 설문의 그룹이 아닙니다.');
  }

  const siblings = await db
    .select({ order: surveyDocumentAnchors.order })
    .from(surveyDocumentAnchors)
    .where(eq(surveyDocumentAnchors.surveyId, input.surveyId));
  const nextOrder = nextOrderAfter(siblings);

  const [inserted] = await db
    .insert(surveyDocumentAnchors)
    .values({
      surveyId: input.surveyId,
      documentId: input.documentId,
      questionId: input.ownerKind === 'question' ? input.ownerId : null,
      groupId: input.ownerKind === 'group' ? input.ownerId : null,
      page: input.rect.page,
      x: input.rect.x,
      y: input.rect.y,
      w: input.rect.w,
      h: input.rect.h,
      order: nextOrder,
    })
    .returning();
  if (!inserted) throw new SurveyAnchorError('영역을 저장하지 못했습니다.');
  return toAnchor(inserted);
}

export async function removeSurveyAnchor(input: RemoveSurveyAnchorInput): Promise<void> {
  await db
    .delete(surveyDocumentAnchors)
    .where(
      and(
        eq(surveyDocumentAnchors.id, input.anchorId),
        eq(surveyDocumentAnchors.surveyId, input.surveyId),
      ),
    );
}
