'use client';

import { useCallback, useTransition } from 'react';

import {
  createCategory as createCategoryAction,
  deleteCategory as deleteCategoryAction,
  exportLibrary as exportLibraryAction,
  importLibrary as importLibraryAction,
  initializeDefaultCategories,
  initializePresetQuestions,
  updateCategory as updateCategoryAction,
} from '@/actions/library-actions';
import { getAllCategories, getAllTags } from '@/actions/query-actions';
import { client } from '@/shared/lib/rpc';

/**
 * 질문 보관함과 DB를 동기화하는 훅
 * 조회 및 변경 모두 oRPC client를 사용한다.
 */
export function useLibrarySync() {
  const [isPending, startTransition] = useTransition();

  // 질문 저장
  const saveQuestion = useCallback(
    async (
      question: Parameters<typeof client.library.savedQuestions.create>[0]['question'],
      metadata: Parameters<typeof client.library.savedQuestions.create>[0]['metadata'],
    ) => {
      try {
        const saved = await client.library.savedQuestions.create({ question, metadata });
        return saved;
      } catch (error) {
        console.error('질문 저장 실패:', error);
        throw error;
      }
    },
    [],
  );

  // 저장된 질문 업데이트
  const updateSavedQuestion = useCallback(
    async (
      id: string,
      updates: Parameters<typeof client.library.savedQuestions.update>[0]['updates'],
    ) => {
      try {
        const updated = await client.library.savedQuestions.update({ id, updates });
        return updated;
      } catch (error) {
        console.error('질문 업데이트 실패:', error);
        throw error;
      }
    },
    [],
  );

  // 저장된 질문 삭제
  const deleteSavedQuestion = useCallback(async (id: string) => {
    try {
      await client.library.savedQuestions.remove({ id });
    } catch (error) {
      console.error('질문 삭제 실패:', error);
      throw error;
    }
  }, []);

  // 모든 저장된 질문 불러오기
  const loadAllQuestions = useCallback(async () => {
    try {
      const questions = await client.library.savedQuestions.list({});
      return questions;
    } catch (error) {
      console.error('질문 목록 불러오기 실패:', error);
      throw error;
    }
  }, []);

  // 카테고리별 질문 불러오기
  const loadQuestionsByCategory = useCallback(async (category: string) => {
    try {
      const questions = await client.library.savedQuestions.byCategory({ category });
      return questions;
    } catch (error) {
      console.error('카테고리별 질문 불러오기 실패:', error);
      throw error;
    }
  }, []);

  // 질문 검색
  const searchQuestions = useCallback(async (query: string) => {
    try {
      const questions = await client.library.savedQuestions.search({ query });
      return questions;
    } catch (error) {
      console.error('질문 검색 실패:', error);
      throw error;
    }
  }, []);

  // 최근 사용 질문 불러오기
  const loadRecentlyUsed = useCallback(async (limit?: number) => {
    try {
      const questions = await client.library.savedQuestions.recentlyUsed({ limit });
      return questions;
    } catch (error) {
      console.error('최근 사용 질문 불러오기 실패:', error);
      throw error;
    }
  }, []);

  // 가장 많이 사용된 질문 불러오기
  const loadMostUsed = useCallback(async (limit?: number) => {
    try {
      const questions = await client.library.savedQuestions.mostUsed({ limit });
      return questions;
    } catch (error) {
      console.error('인기 질문 불러오기 실패:', error);
      throw error;
    }
  }, []);

  // 질문 적용 (복제해서 반환)
  const applyQuestion = useCallback(async (id: string) => {
    try {
      const question = await client.library.savedQuestions.apply({ id });
      return question;
    } catch (error) {
      console.error('질문 적용 실패:', error);
      throw error;
    }
  }, []);

  // 여러 질문 적용
  const applyMultipleQuestions = useCallback(async (ids: string[]) => {
    try {
      const questions = await client.library.savedQuestions.applyMultiple({ ids });
      return questions;
    } catch (error) {
      console.error('여러 질문 적용 실패:', error);
      throw error;
    }
  }, []);

  // 모든 태그 불러오기
  const loadAllTags = useCallback(async () => {
    try {
      const tags = await getAllTags();
      return tags;
    } catch (error) {
      console.error('태그 불러오기 실패:', error);
      throw error;
    }
  }, []);

  // 태그별 질문 불러오기
  const loadQuestionsByTag = useCallback(async (tag: string) => {
    try {
      const questions = await client.library.savedQuestions.byTag({ tag });
      return questions;
    } catch (error) {
      console.error('태그별 질문 불러오기 실패:', error);
      throw error;
    }
  }, []);

  // 라이브러리 내보내기
  const exportLibrary = useCallback(async () => {
    try {
      const json = await exportLibraryAction();
      return json;
    } catch (error) {
      console.error('라이브러리 내보내기 실패:', error);
      throw error;
    }
  }, []);

  // 라이브러리 가져오기
  const importLibrary = useCallback(async (json: string) => {
    try {
      await importLibraryAction(json);
    } catch (error) {
      console.error('라이브러리 가져오기 실패:', error);
      throw error;
    }
  }, []);

  return {
    isPending,
    saveQuestion,
    updateSavedQuestion,
    deleteSavedQuestion,
    loadAllQuestions,
    loadQuestionsByCategory,
    searchQuestions,
    loadRecentlyUsed,
    loadMostUsed,
    applyQuestion,
    applyMultipleQuestions,
    loadAllTags,
    loadQuestionsByTag,
    exportLibrary,
    importLibrary,
    startTransition,
  };
}

/**
 * 카테고리와 DB를 동기화하는 훅
 */
export function useCategorySync() {
  const [isPending, startTransition] = useTransition();

  // 모든 카테고리 불러오기
  const loadCategories = useCallback(async () => {
    try {
      const categories = await getAllCategories();
      return categories;
    } catch (error) {
      console.error('카테고리 불러오기 실패:', error);
      throw error;
    }
  }, []);

  // 카테고리 생성
  const createCategory = useCallback(async (name: string, color?: string) => {
    try {
      const category = await createCategoryAction(name, color);
      return category;
    } catch (error) {
      console.error('카테고리 생성 실패:', error);
      throw error;
    }
  }, []);

  // 카테고리 업데이트
  const updateCategory = useCallback(
    async (
      id: string,
      updates: Partial<{
        name: string;
        color: string;
        icon: string;
        order: number;
      }>,
    ) => {
      try {
        const updated = await updateCategoryAction(id, updates);
        return updated;
      } catch (error) {
        console.error('카테고리 업데이트 실패:', error);
        throw error;
      }
    },
    [],
  );

  // 카테고리 삭제
  const deleteCategory = useCallback(async (id: string) => {
    try {
      await deleteCategoryAction(id);
    } catch (error) {
      console.error('카테고리 삭제 실패:', error);
      throw error;
    }
  }, []);

  // 기본 카테고리 초기화
  const initializeCategories = useCallback(async () => {
    try {
      const categories = await initializeDefaultCategories();
      return categories;
    } catch (error) {
      console.error('카테고리 초기화 실패:', error);
      throw error;
    }
  }, []);

  // 프리셋 질문 초기화
  const initializePresets = useCallback(async () => {
    try {
      const questions = await initializePresetQuestions();
      return questions;
    } catch (error) {
      console.error('프리셋 질문 초기화 실패:', error);
      throw error;
    }
  }, []);

  return {
    isPending,
    loadCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    initializeCategories,
    initializePresets,
    startTransition,
  };
}
