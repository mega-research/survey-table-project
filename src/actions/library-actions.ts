'use server';

import { revalidatePath } from 'next/cache';

import { eq, inArray, sql } from 'drizzle-orm';

import { getAllCategories, getAllSavedQuestions } from '@/data/library';
import { db } from '@/db';
import {
  NewQuestionCategory,
  NewSavedQuestion,
  questionCategories,
  savedQuestions,
} from '@/db/schema';
import { requireAuth } from '@/lib/auth';
import { extractImageUrlsFromQuestion } from '@/lib/image-extractor';
import { deleteImagesFromR2Server } from '@/lib/image-utils-server';
import { promoteSurveyImages } from '@/lib/survey/survey-image-promote';
import { generateId } from '@/lib/utils';
import type { Question } from '@/types/survey';

// ========================
// 질문 보관함 변경 액션 (Mutations)
// ========================

// 질문 저장
export async function saveQuestion(
  question: Question,
  metadata: {
    name: string;
    description?: string;
    category: string;
    tags?: string[];
  },
) {
  await requireAuth();

  // tmp/survey/ 이미지를 영구 prefix로 promote (R2 move + URL 치환)
  const [promotedQuestion] = await promoteSurveyImages([question]);

  const newSavedQuestion: NewSavedQuestion = {
    question: promotedQuestion as unknown as NewSavedQuestion['question'],
    name: metadata.name,
    description: metadata.description,
    category: metadata.category,
    tags: metadata.tags || [],
    usageCount: 0,
    isPreset: false,
  };

  const [saved] = await db.insert(savedQuestions).values(newSavedQuestion).returning();
  revalidatePath('/admin/surveys');
  return saved;
}

// 저장된 질문 업데이트
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
  await requireAuth();

  // question이 포함된 경우 tmp/survey/ 이미지 promote
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

  revalidatePath('/admin/surveys');
  return updated;
}

// 저장된 질문 삭제
export async function deleteSavedQuestion(id: string) {
  await requireAuth();

  // 삭제 전 저장된 질문 조회
  const savedQuestion = await db.query.savedQuestions.findFirst({
    where: eq(savedQuestions.id, id),
  });

  if (savedQuestion) {
    // questionData에서 질문 객체 추출
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
  revalidatePath('/admin/surveys');
}

// 질문 사용 (usageCount 원자적 증가)
export async function applyQuestion(id: string) {
  await requireAuth();

  // 🚀 원자적 증가 (Atomic Increment) - DB가 직접 계산
  // Race Condition 방지: 동시에 여러 명이 사용해도 정확히 카운트됨
  const [updated] = await db
    .update(savedQuestions)
    .set({
      usageCount: sql`${savedQuestions.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(savedQuestions.id, id))
    .returning();

  if (!updated) return null;

  // 새 ID로 복제된 질문 반환
  const question = updated.question as unknown as Question;

  return {
    ...question,
    id: generateId(),
    order: 0,
    groupId: undefined, // 보관함에서 추가할 때는 그룹 없이 추가
  };
}

// 여러 질문 사용 (일괄 처리 최적화)
export async function applyMultipleQuestions(ids: string[]) {
  await requireAuth();

  if (!ids.length) return [];

  // 1. 일괄 조회 (1번 요청)
  const savedItems = await db.query.savedQuestions.findMany({
    where: inArray(savedQuestions.id, ids),
  });

  if (!savedItems.length) return [];

  // 2. 일괄 업데이트 (1번 요청) - usageCount를 SQL 레벨에서 1씩 증가
  await db
    .update(savedQuestions)
    .set({
      usageCount: sql`${savedQuestions.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(inArray(savedQuestions.id, ids));

  // 3. 메모리에서 데이터 가공 (새 ID 부여)
  return savedItems.map((saved) => {
    const question = saved.question as unknown as Question;
    return {
      ...question,
      id: generateId(),
      order: 0,
      groupId: undefined,
    };
  });
}

// 라이브러리 내보내기
export async function exportLibrary() {
  await requireAuth();

  const questions = await getAllSavedQuestions();
  const categories = await getAllCategories();
  return JSON.stringify({ savedQuestions: questions, categories }, null, 2);
}

// 라이브러리 가져오기
export async function importLibrary(json: string) {
  await requireAuth();

  try {
    const data = JSON.parse(json);

    if (data.savedQuestions) {
      // tmp/survey/ URL 포함 가능성 (다른 환경 export) → promote 후 insert
      const rawQuestions: Question[] = data.savedQuestions.map(
        (sq: NewSavedQuestion) => sq.question as unknown as Question,
      );
      const promotedQuestions = await promoteSurveyImages(rawQuestions);

      const importedQuestions: NewSavedQuestion[] = data.savedQuestions.map(
        (sq: NewSavedQuestion, i: number) => ({
          ...sq,
          question: promotedQuestions[i] as unknown as NewSavedQuestion['question'],
          isPreset: false,
        }),
      );

      await db.insert(savedQuestions).values(importedQuestions);
    }

    if (data.categories) {
      const existingCategories = await getAllCategories();
      const existingIds = new Set(existingCategories.map((c) => c.id));

      const newCategories = data.categories.filter(
        (c: NewQuestionCategory) => !existingIds.has(c.id!),
      );

      if (newCategories.length > 0) {
        await db.insert(questionCategories).values(newCategories);
      }
    }

    revalidatePath('/admin/surveys');
  } catch (error) {
    console.error('Failed to import library:', error);
    throw error;
  }
}

// ========================
// 카테고리 변경 액션 (Mutations)
// ========================

// 카테고리 생성
export async function createCategory(name: string, color: string = 'bg-gray-100 text-gray-600') {
  await requireAuth();

  const categories = await getAllCategories();
  const maxOrder = categories.length > 0 ? Math.max(...categories.map((c) => c.order)) : -1;

  const newCategory: NewQuestionCategory = {
    name,
    color,
    order: maxOrder + 1,
  };

  const [category] = await db.insert(questionCategories).values(newCategory).returning();
  revalidatePath('/admin/surveys');
  return category;
}

// 카테고리 업데이트
export async function updateCategory(
  id: string,
  updates: Partial<{
    name: string;
    color: string;
    icon: string;
    order: number;
  }>,
) {
  await requireAuth();

  const [updated] = await db
    .update(questionCategories)
    .set(updates)
    .where(eq(questionCategories.id, id))
    .returning();

  revalidatePath('/admin/surveys');
  return updated;
}

// 카테고리 삭제
export async function deleteCategory(id: string) {
  await requireAuth();

  // 해당 카테고리의 질문들을 'custom'으로 이동
  await db
    .update(savedQuestions)
    .set({ category: 'custom' })
    .where(eq(savedQuestions.category, id));

  await db.delete(questionCategories).where(eq(questionCategories.id, id));
  revalidatePath('/admin/surveys');
}

// 기본 카테고리 초기화
export async function initializeDefaultCategories() {
  await requireAuth();

  const existingCategories = await getAllCategories();

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

  const inserted = await db.insert(questionCategories).values(defaultCategories).returning();
  return inserted;
}

// 프리셋 질문 초기화
export async function initializePresetQuestions() {
  await requireAuth();

  const existingQuestions = await db.query.savedQuestions.findMany({
    where: eq(savedQuestions.isPreset, true),
  });

  if (existingQuestions.length > 0) {
    return existingQuestions;
  }

  const presetQuestions: NewSavedQuestion[] = [
    {
      name: '성별 질문',
      description: '응답자의 성별을 묻는 기본 질문입니다.',
      category: 'demographics',
      tags: ['기본정보', '필수'],
      usageCount: 0,
      isPreset: true,
      question: {
        id: 'preset-gender',
        type: 'radio',
        title: '귀하의 성별은 무엇입니까?',
        required: true,
        order: 0,
        options: [
          { id: 'opt-male', label: '남성', value: '남성' },
          { id: 'opt-female', label: '여성', value: '여성' },
        ],
      },
    },
    {
      name: '연령대 질문',
      description: '응답자의 연령대를 묻는 질문입니다.',
      category: 'demographics',
      tags: ['기본정보', '필수'],
      usageCount: 0,
      isPreset: true,
      question: {
        id: 'preset-age',
        type: 'radio',
        title: '귀하의 연령대는 어떻게 되십니까?',
        required: true,
        order: 0,
        options: [
          { id: 'opt-age-10', label: '10대', value: '10대' },
          { id: 'opt-age-20', label: '20대', value: '20대' },
          { id: 'opt-age-30', label: '30대', value: '30대' },
          { id: 'opt-age-40', label: '40대', value: '40대' },
          { id: 'opt-age-50', label: '50대', value: '50대' },
          { id: 'opt-age-60', label: '60대 이상', value: '60대 이상' },
        ],
      },
    },
    {
      name: '5점 만족도 질문',
      description: '5점 척도로 만족도를 측정하는 질문입니다.',
      category: 'satisfaction',
      tags: ['만족도', '5점척도'],
      usageCount: 0,
      isPreset: true,
      question: {
        id: 'preset-satisfaction-5',
        type: 'radio',
        title: '전반적인 만족도는 어떠십니까?',
        required: true,
        order: 0,
        options: [
          { id: 'opt-sat-1', label: '매우 불만족', value: '1' },
          { id: 'opt-sat-2', label: '불만족', value: '2' },
          { id: 'opt-sat-3', label: '보통', value: '3' },
          { id: 'opt-sat-4', label: '만족', value: '4' },
          { id: 'opt-sat-5', label: '매우 만족', value: '5' },
        ],
      },
    },
    {
      name: 'NPS 추천 의향',
      description: 'Net Promoter Score를 측정하는 표준 질문입니다. (0-10점)',
      category: 'nps',
      tags: ['NPS', '추천의향', '11점척도'],
      usageCount: 0,
      isPreset: true,
      question: {
        id: 'preset-nps',
        type: 'radio',
        title: '이 서비스를 주변 지인에게 추천할 의향이 얼마나 되십니까?',
        description: '0점(전혀 추천하지 않음)부터 10점(적극 추천)까지 선택해 주세요.',
        required: true,
        order: 0,
        options: Array.from({ length: 11 }, (_, i) => ({
          id: `opt-nps-${i}`,
          label: String(i),
          value: String(i),
        })),
      },
    },
    {
      name: '개선점 피드백',
      description: '서비스 개선점에 대한 의견을 수집하는 질문입니다.',
      category: 'feedback',
      tags: ['피드백', '개선'],
      usageCount: 0,
      isPreset: true,
      question: {
        id: 'preset-improvement',
        type: 'textarea',
        title: '서비스 개선을 위한 의견이 있으시면 자유롭게 작성해 주세요.',
        description: '귀하의 소중한 의견은 서비스 개선에 큰 도움이 됩니다.',
        required: false,
        order: 0,
      },
    },
  ];

  const inserted = await db.insert(savedQuestions).values(presetQuestions).returning();
  return inserted;
}
