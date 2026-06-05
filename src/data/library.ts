import { db } from '@/db';
import { questionCategories } from '@/db/schema';

// ========================
// 태그 조회 함수
// ========================

// 모든 태그 조회
export async function getAllTags() {
  const questions = await db.query.savedQuestions.findMany();
  const tagSet = new Set<string>();

  questions.forEach((q) => {
    const tags = q.tags as string[] | null;
    if (tags) {
      tags.forEach((tag) => tagSet.add(tag));
    }
  });

  return Array.from(tagSet).sort();
}

// ========================
// 카테고리 조회 함수
// ========================

// 모든 카테고리 조회
export async function getAllCategories() {
  const categories = await db.query.questionCategories.findMany({
    orderBy: [questionCategories.order],
  });
  return categories;
}
