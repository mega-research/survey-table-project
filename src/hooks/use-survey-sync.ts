'use client';

import { useCallback, useRef, useState, useTransition } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { surveyKeys } from '@/hooks/queries/use-surveys';
import { buildSurveyDiffPayload } from '@/lib/survey-builder/diff-payload';
import { client, orpc } from '@/shared/lib/rpc';
import {
  useSurveyBuilderStore,
  useSurveyListStore,
  useSurveyUIStore,
  useTestResponseStore,
} from '@/stores';

/**
 * 설문 빌더와 DB를 동기화하는 훅
 */
export function useSurveySync() {
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const resetSurvey = useSurveyBuilderStore((s) => s.resetSurvey);
  const markSavedSnapshotClean = useSurveyBuilderStore((s) => s.markSavedSnapshotClean);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  // 동기 중복-저장 가드: React state(isSaving)는 같은 렌더 틱 내 두 호출이 모두
  // stale false 를 읽으므로 가드로 부적합. ref 는 동기 기록되어 같은 틱에서도 즉시 반영된다.
  const savingRef = useRef(false);

  // Diff 기반 저장: 변경분만 서버에 전송
  const saveSurvey = useCallback(
    async () => {
      const store = useSurveyBuilderStore.getState();

      if (!store.currentSurvey.id) {
        console.error('설문 ID가 없습니다.');
        return null;
      }

      if (savingRef.current) {
        console.log('이미 저장 중입니다. 중복 저장을 방지합니다.');
        return null;
      }

      // 변경 없으면 저장 스킵
      if (!store.isDirty) {
        return { surveyId: store.currentSurvey.id };
      }

      savingRef.current = true;
      setIsSaving(true);
      setSaveError(null);

      // 스냅샷: 현재 changeset을 캡처하고 초기화 (저장 중 새 변경은 새 changeset에 쌓임)
      const snapshot = store.snapshotChanges();

      try {
        const survey = useSurveyBuilderStore.getState().currentSurvey;

        // payload 조립 지식(store 상태 → payload 필드 규칙)은 diff-payload 모듈 소유
        const payload = buildSurveyDiffPayload(survey, snapshot);

        // 변경분이 전혀 없으면 스킵
        if (!payload) {
          markSavedSnapshotClean();
          return { surveyId: survey.id };
        }

        const result = await client.surveyBuilder.save.saveDiff(payload);
        markSavedSnapshotClean();
        // 저장 후 TanStack Query 캐시 무효화 → 다음 로드 시 DB에서 최신 데이터 사용
        queryClient.invalidateQueries({ queryKey: surveyKeys.detail(survey.id) });
        queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
        return result;
      } catch (error) {
        // 실패 시 스냅샷을 현재 changeset에 merge back
        useSurveyBuilderStore.getState().mergeChangesBack(snapshot);
        const err = error instanceof Error ? error : new Error('설문 저장 실패');
        console.error('설문 저장 실패:', err);
        setSaveError(err);
        throw err;
      } finally {
        savingRef.current = false;
        setIsSaving(false);
      }
    },
    [markSavedSnapshotClean, queryClient],
  );

  // DB에서 설문 불러오기
  const loadSurvey = useCallback(async (surveyId: string) => {
    try {
      const survey = await client.surveyBuilder.read.withDetails({ surveyId });
      if (survey) {
        // Zustand store 업데이트 (changeset도 함께 리셋)
        useSurveyBuilderStore.getState().setSurvey(survey);

        // UI 상태 초기화
        useSurveyUIStore.getState().selectQuestion(null);

        // 미리보기(실제 렌더링) 테스트 응답 초기화
        useTestResponseStore.getState().clearTestResponses();
      }
      return survey;
    } catch (error) {
      console.error('설문 불러오기 실패:', error);
      throw error;
    }
  }, []);

  // 새 설문 생성 (DB + Store)
  const createNewSurvey = useCallback(async () => {
    resetSurvey();

    // UI 및 테스트 응답 초기화
    useSurveyUIStore.getState().selectQuestion(null);
    useTestResponseStore.getState().clearTestResponses();

    const newSurvey = useSurveyBuilderStore.getState().currentSurvey;

    try {
      const result = await client.surveyBuilder.save.saveWithDetails(newSurvey);
      // 생성된 ID로 store 업데이트
      useSurveyBuilderStore.setState((state) => ({
        currentSurvey: {
          ...state.currentSurvey,
          id: result.surveyId,
        },
      }));
      return result.surveyId;
    } catch (error) {
      console.error('새 설문 생성 실패:', error);
      throw error;
    }
  }, [resetSurvey]);

  return {
    isPending,
    isSaving,
    saveError,
    saveSurvey,
    loadSurvey,
    createNewSurvey,
    startTransition,
  };
}

/**
 * 설문 목록과 DB를 동기화하는 훅
 */
export function useSurveyListSync() {
  const [isPending, startTransition] = useTransition();

  // DB에서 설문 목록 불러오기
  const loadSurveyList = useCallback(async () => {
    try {
      const surveys = await client.surveyBuilder.read.list();

      // Zustand store 업데이트 (선택사항 - 캐싱용)
      // useSurveyListStore.setState({ surveys: ... });

      return surveys;
    } catch (error) {
      console.error('설문 목록 불러오기 실패:', error);
      throw error;
    }
  }, []);

  // 설문 삭제
  const deleteSurvey = useCallback(async (surveyId: string) => {
    try {
      await client.surveyBuilder.surveys.delete({ surveyId });
      // 로컬 store에서 선택 해제 (목록에서 삭제는 쿼리 무효화로 처리됨)
      useSurveyListStore.getState().deselectSurvey(surveyId);
    } catch (error) {
      console.error('설문 삭제 실패:', error);
      throw error;
    }
  }, []);

  // 설문 복제
  const duplicateSurvey = useCallback(async (surveyId: string) => {
    try {
      const newSurvey = await client.surveyBuilder.surveys.duplicate({ surveyId });
      return newSurvey;
    } catch (error) {
      console.error('설문 복제 실패:', error);
      throw error;
    }
  }, []);

  return {
    isPending,
    loadSurveyList,
    deleteSurvey,
    duplicateSurvey,
    startTransition,
  };
}

/**
 * 설문 응답과 DB를 동기화하는 훅
 */
export function useResponseSync() {
  const [isPending, startTransition] = useTransition();

  // 질문 응답 업데이트
  const updateQuestionResponse = useCallback(
    async (responseId: string, questionId: string, value: unknown) => {
      try {
        const updated = await client.surveyResponse.response.updateAnswer({
          responseId,
          questionId,
          value,
        });
        return updated;
      } catch (error) {
        console.error('응답 업데이트 실패:', error);
        throw error;
      }
    },
    [],
  );

  // 응답 완료
  const completeResponse = useCallback(async (responseId: string) => {
    try {
      const completed = await client.surveyResponse.response.complete({ responseId });
      return completed;
    } catch (error) {
      console.error('응답 완료 실패:', error);
      throw error;
    }
  }, []);

  // 설문별 응답 목록 불러오기
  const loadResponses = useCallback(async (surveyId: string) => {
    try {
      const responses = await client.surveyBuilder.read.responsesBySurvey({ surveyId });
      return responses;
    } catch (error) {
      console.error('응답 목록 불러오기 실패:', error);
      throw error;
    }
  }, []);

  // 응답 통계 불러오기
  const loadResponseSummary = useCallback(async (surveyId: string) => {
    try {
      const summary = await orpc.analytics.stats.survey.call({ surveyId });
      return summary;
    } catch (error) {
      console.error('응답 통계 불러오기 실패:', error);
      throw error;
    }
  }, []);

  return {
    isPending,
    updateQuestionResponse,
    completeResponse,
    loadResponses,
    loadResponseSummary,
    startTransition,
  };
}
