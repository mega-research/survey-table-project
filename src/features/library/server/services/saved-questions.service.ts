import 'server-only';

import { desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { NewSavedQuestion, savedQuestions } from '@/db/schema/surveys';
import { extractImageUrlsFromQuestion } from '@/lib/image-extractor';
import { deleteImagesFromR2Server } from '@/lib/image-utils-server';
import { promoteSurveyImages } from '@/lib/survey/survey-image-promote';
import { generateId } from '@/lib/utils';
import type { Question, SavedQuestion } from '@/types/survey';

// ========================
// 쿼리
// ========================

/** 모든 저장된 질문 조회 (최근 수정순) */
export async function listSavedQuestions(): Promise<SavedQuestion[]> {
  const questions = await db.query.savedQuestions.findMany({
    orderBy: [desc(savedQuestions.updatedAt)],
  });
  return questions as unknown as SavedQuestion[];
}

/** 이름/설명 검색 */
export async function searchSavedQuestions(query: string): Promise<SavedQuestion[]> {
  const questions = await db.query.savedQuestions.findMany({
    where: or(
      ilike(savedQuestions.name, `%${query}%`),
      ilike(savedQuestions.description, `%${query}%`),
    ),
    orderBy: [desc(savedQuestions.updatedAt)],
  });
  return questions as unknown as SavedQuestion[];
}

/** 카테고리별 질문 조회 */
export async function getSavedQuestionsByCategory(category: string): Promise<SavedQuestion[]> {
  const questions = await db.query.savedQuestions.findMany({
    where: eq(savedQuestions.category, category),
    orderBy: [desc(savedQuestions.updatedAt)],
  });
  return questions as unknown as SavedQuestion[];
}

/** 최근 사용된 질문 조회 (usageCount > 0, updatedAt 최신순) */
export async function getRecentlyUsedQuestions(limit: number = 5): Promise<SavedQuestion[]> {
  const questions = await db.query.savedQuestions.findMany({
    orderBy: [desc(savedQuestions.updatedAt)],
    limit,
  });
  return questions.filter((q) => q.usageCount > 0) as unknown as SavedQuestion[];
}

/** 사용 횟수 많은 질문 조회 */
export async function getMostUsedQuestions(limit: number = 5): Promise<SavedQuestion[]> {
  const questions = await db.query.savedQuestions.findMany({
    orderBy: [desc(savedQuestions.usageCount)],
    limit,
  });
  return questions as unknown as SavedQuestion[];
}

/** 태그로 질문 조회 */
export async function getSavedQuestionsByTag(tag: string): Promise<SavedQuestion[]> {
  const questions = await db.query.savedQuestions.findMany();
  return questions.filter((q) => {
    const tags = q.tags as string[] | null;
    return tags?.includes(tag);
  }) as unknown as SavedQuestion[];
}

// ========================
// 뮤테이션
// ========================

/** 질문 저장 — tmp/survey/ 이미지를 영구 prefix로 promote 후 insert */
export async function createSavedQuestion(input: {
  question: Question;
  metadata: {
    name: string;
    description?: string;
    category: string;
    tags?: string[];
  };
}) {
  const [promotedQuestion] = await promoteSurveyImages([input.question]);

  const newSavedQuestion: NewSavedQuestion = {
    question: promotedQuestion as unknown as NewSavedQuestion['question'],
    name: input.metadata.name,
    description: input.metadata.description,
    category: input.metadata.category,
    tags: input.metadata.tags ?? [],
    usageCount: 0,
    isPreset: false,
  };

  const [saved] = await db.insert(savedQuestions).values(newSavedQuestion).returning();
  return saved;
}

/** 저장된 질문 업데이트 — question 포함 시 이미지 promote */
export async function updateSavedQuestion(
  id: string,
  updates: Partial<{
    name: string;
    description: string;
    category: string;
    tags: string[];
    question: Question;
  }>,
) {
  let promotedQuestion = updates.question;
  if (updates.question) {
    const [promoted] = await promoteSurveyImages([updates.question]);
    promotedQuestion = promoted;
  }

  const [updated] = await db
    .update(savedQuestions)
    .set({
      ...updates,
      question: promotedQuestion as unknown as NewSavedQuestion['question'],
      updatedAt: new Date(),
    })
    .where(eq(savedQuestions.id, id))
    .returning();

  return updated;
}

/** 저장된 질문 삭제 — 연결 이미지 R2에서도 삭제 시도 */
export async function deleteSavedQuestion(id: string): Promise<void> {
  const savedQuestion = await db.query.savedQuestions.findFirst({
    where: eq(savedQuestions.id, id),
  });

  if (savedQuestion) {
    const question = savedQuestion.question as unknown as Question;
    const images = extractImageUrlsFromQuestion(question);

    if (images.length > 0) {
      try {
        await deleteImagesFromR2Server(images);
      } catch (error) {
        console.error('라이브러리 질문 삭제 시 이미지 삭제 실패:', error);
        // 이미지 삭제 실패해도 질문 삭제는 진행
      }
    }
  }

  await db.delete(savedQuestions).where(eq(savedQuestions.id, id));
}

/**
 * 질문 사용 — usageCount 원자적 증가 후 새 id를 부여한 Question 객체 반환.
 * 존재하지 않는 id면 null 반환.
 */
export async function applySavedQuestion(id: string): Promise<Question | null> {
  const [updated] = await db
    .update(savedQuestions)
    .set({
      usageCount: sql`${savedQuestions.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(savedQuestions.id, id))
    .returning();

  if (!updated) return null;

  const question = updated.question as unknown as Question;
  const { groupId: _g, ...questionWithoutGroup } = question;
  return {
    ...questionWithoutGroup,
    id: generateId(),
    order: 0,
  } as Question;
}

/**
 * 여러 질문 일괄 사용 — 1회 조회 + 1회 업데이트 최적화.
 * 빈 ids 배열이면 [] 반환.
 */
export async function applyMultipleSavedQuestions(ids: string[]): Promise<Question[]> {
  if (!ids.length) return [];

  const savedItems = await db.query.savedQuestions.findMany({
    where: inArray(savedQuestions.id, ids),
  });

  if (!savedItems.length) return [];

  await db
    .update(savedQuestions)
    .set({
      usageCount: sql`${savedQuestions.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(inArray(savedQuestions.id, ids));

  return savedItems.map((saved) => {
    const question = saved.question as unknown as Question;
    const { groupId: _g, ...questionWithoutGroup } = question;
    return {
      ...questionWithoutGroup,
      id: generateId(),
      order: 0,
    } as Question;
  });
}
