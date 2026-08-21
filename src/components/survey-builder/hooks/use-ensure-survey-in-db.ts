'use client';

import { useCallback, useRef } from 'react';

import { client } from '@/shared/lib/rpc';
import { useSurveyBuilderStore } from '@/stores/survey-store';

/**
 * CREATE 페이지에서 서버 액션 호출 전 설문이 DB에 존재하는지 보장하는 훅.
 * - isSavedToDb가 true면 즉시 리턴 (no-op)
 * - 동시 호출 시 Promise dedup으로 단일 서버 요청만 발생
 */
export function useEnsureSurveyInDb() {
  const inflightRef = useRef<Promise<void> | null>(null);

  return useCallback(async () => {
    const store = useSurveyBuilderStore.getState();
    if (store.isSavedToDb) return;

    if (inflightRef.current) {
      await inflightRef.current;
      return;
    }

    const promise = client.surveyBuilder.surveys.ensure({
      id: store.currentSurvey.id,
      title: store.currentSurvey.title,
      ...(store.currentSurvey.privateToken !== undefined ? { privateToken: store.currentSurvey.privateToken } : {}),
      settings: store.currentSurvey.settings,
    })
      .then(() => {
        useSurveyBuilderStore.getState().markSavedToDb();
        inflightRef.current = null;
      })
      .catch((err) => {
        inflightRef.current = null;
        throw err;
      });

    inflightRef.current = promise;
    await promise;
  }, []);
}
