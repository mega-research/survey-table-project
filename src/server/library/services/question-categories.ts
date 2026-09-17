import 'server-only';

import { asc, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { NewQuestionCategory, questionCategories, savedQuestions } from '@/db/schema/surveys';
import type { QuestionCategory } from '@/types/survey';

import type { CreateCategoryInput, UpdateCategoryInput } from '../domain/question-category';

// drizzle $inferSelect row -> domain QuestionCategory 명시 변환
// icon: string | null -> string | undefined (domain은 optional, exactOptionalPropertyTypes 대응)
// createdAt 컬럼은 domain 타입에 없으므로 제외
function toDomainQuestionCategory(
  row: typeof questionCategories.$inferSelect,
): QuestionCategory {
  const result: QuestionCategory = {
    id: row.id,
    name: row.name,
    color: row.color,
    order: row.order,
  };
  if (row.icon != null) {
    result.icon = row.icon;
  }
  return result;
}

// ========================
// 쿼리
// ========================

/** 모든 카테고리 조회 (order 오름차순) */
export async function listCategories(): Promise<QuestionCategory[]> {
  const rows = await db.query.questionCategories.findMany({
    orderBy: [asc(questionCategories.order)],
  });
  return rows.map(toDomainQuestionCategory);
}

// ========================
// 뮤테이션
// ========================

/**
 * 카테고리 생성 — order는 기존 최댓값 + 1로 발번.
 * read-then-write race를 막기 위해 order 발번을 단일 INSERT 안의 상관 서브쿼리로 처리한다.
 * COALESCE(MAX(order), -1) + 1 → 빈 테이블일 때 0부터 시작.
 */
export async function createCategory(input: CreateCategoryInput): Promise<QuestionCategory> {
  const [category] = await db
    .insert(questionCategories)
    .values({
      name: input.name,
      color: input.color ?? 'bg-gray-100 text-gray-600',
      order: sql`(SELECT COALESCE(MAX(${questionCategories.order}), -1) + 1 FROM ${questionCategories})`,
    })
    .returning();
  if (!category) throw new Error('카테고리 생성에 실패했습니다.');
  return toDomainQuestionCategory(category);
}

/** 카테고리 업데이트 */
export async function updateCategory(
  id: string,
  updates: UpdateCategoryInput['updates'],
): Promise<QuestionCategory> {
  const [updated] = await db
    .update(questionCategories)
    .set(updates)
    .where(eq(questionCategories.id, id))
    .returning();

  if (!updated) throw new Error('카테고리 수정에 실패했습니다.');
  return toDomainQuestionCategory(updated);
}

/** 카테고리 삭제 — 해당 카테고리의 질문들을 'custom'으로 이동 후 삭제 */
export async function deleteCategory(id: string): Promise<void> {
  await db
    .update(savedQuestions)
    .set({ category: 'custom' })
    .where(eq(savedQuestions.category, id));

  await db.delete(questionCategories).where(eq(questionCategories.id, id));
}

/**
 * 기본 카테고리 초기화 — 이미 카테고리가 존재하면 기존 목록 반환,
 * 없으면 기본 6종 삽입 후 반환.
 */
export async function initializeDefaultCategories(): Promise<QuestionCategory[]> {
  const existingCategories = await listCategories();

  if (existingCategories.length > 0) {
    return existingCategories;
  }

  const defaultCategories: NewQuestionCategory[] = [
    { name: '인구통계', color: 'bg-blue-100 text-blue-600', icon: 'Users', order: 0 },
    { name: '만족도', color: 'bg-green-100 text-green-600', icon: 'ThumbsUp', order: 1 },
    { name: 'NPS', color: 'bg-purple-100 text-purple-600', icon: 'TrendingUp', order: 2 },
    { name: '피드백', color: 'bg-orange-100 text-orange-600', icon: 'MessageSquare', order: 3 },
    { name: '선호도', color: 'bg-pink-100 text-pink-600', icon: 'Heart', order: 4 },
    { name: '사용자 정의', color: 'bg-gray-100 text-gray-600', icon: 'Folder', order: 5 },
  ];

  const inserted = await db
    .insert(questionCategories)
    .values(defaultCategories)
    .returning();
  return inserted.map(toDomainQuestionCategory);
}
