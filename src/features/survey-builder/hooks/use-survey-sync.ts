'use client';

import { useCallback, useState, useTransition } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { buildSurveyDiffPayload } from '@/features/survey-builder/lib/diff-payload';
import { surveyKeys } from '@/features/survey-builder/queries/use-surveys';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { useTestResponseStore } from '@/features/survey-builder/stores/test-response-store';
import { useSurveyUIStore } from '@/features/survey-builder/stores/ui-store';
import { client } from '@/shared/lib/rpc';

/**
 * 빌더 저장은 한 줄로 선다 — 앞 저장이 끝난 뒤에 다음 저장이 시작한다.
 *
 * 전에는 저장 중에 저장이 또 오면 「이미 저장 중」이라며 null 을 돌려줬다. 호출부는 그것을 성공으로
 * 읽어 저장 완료 창을 띄우고 배포는 저장 없이 진행했으므로, 그 사이 바뀐 내용이 저장되지 않은 채
 * 「저장됨」으로 보였다(2026-10-20 점검 B7). 기다렸다가 돌면 뒤 저장이 그 사이 쌓인 변경(앞 저장이
 * 실패해 되돌려진 변경 포함)을 싣는다.
 *
 * 줄은 모듈에 하나다. 훅을 쓰는 화면(편집 화면 · 조사표 패널 · 리매핑 자동 저장)이 같은 설문 스토어의
 * 같은 changeset 을 저장하기 때문이다 — 훅마다 ref 를 두던 가드는 화면끼리 서로를 보지 못했다.
 */
let builderSaveQueue: Promise<unknown> = Promise.resolve();

function enqueueBuilderSave<T>(run: () => Promise<T>): Promise<T> {
  // 앞 저장의 실패는 그 호출자가 받는다 — 줄은 실패해도 이어진다.
  const next = builderSaveQueue.then(run, run);
  builderSaveQueue = next.catch(() => undefined);
  return next;
}

/**
 * 설문 빌더와 DB를 동기화하는 훅
 */
export function useSurveySync() {
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const resetSurvey = useSurveyBuilderStore((s) => s.resetSurvey);
  const markSavedSnapshotClean = useSurveyBuilderStore((s) => s.markSavedSnapshotClean);
  const { mutateAsync: saveDiff, isPending: isSaving } = useMutation({
    mutationFn: (payload: Parameters<typeof client.surveyBuilder.save.saveDiff>[0]) =>
      client.surveyBuilder.save.saveDiff(payload),
  });
  const [saveError, setSaveError] = useState<Error | null>(null);

  // Diff 기반 저장: 변경분만 서버에 전송
  const saveSurvey = useCallback(async () => {
    if (!useSurveyBuilderStore.getState().currentSurvey.id) {
      console.error('설문 ID가 없습니다.');
      return null;
    }

    return enqueueBuilderSave(() => {
      // 차례가 온 뒤에 읽는다 — 기다리는 동안 앞 저장이 changeset 을 비웠거나 되돌렸을 수 있다.
      const store = useSurveyBuilderStore.getState();

      // 변경 없으면 저장 스킵
      if (!store.isDirty) {
        return Promise.resolve({ surveyId: store.currentSurvey.id });
      }

      setSaveError(null);

      // 스냅샷: 현재 changeset을 캡처하고 초기화 (저장 중 새 변경은 새 changeset에 쌓임)
      const snapshot = store.snapshotChanges();

      // then/catch 사슬 = 원래 try/catch 와 같은 순서. 호출부(edit/page·create/page)가
      // 실패 예외를 소비하므로 catch 는 다시 던진다. 훅 본문에 try 를 두지 않아 컴파일러 skip 도 없다.
      return Promise.resolve()
        .then(async () => {
          const survey = useSurveyBuilderStore.getState().currentSurvey;

          // payload 조립 지식(store 상태 → payload 필드 규칙)은 diff-payload 모듈 소유
          const payload = buildSurveyDiffPayload(survey, snapshot);

          // 변경분이 전혀 없으면 스킵
          if (!payload) {
            markSavedSnapshotClean();
            return { surveyId: survey.id };
          }

          const result = await saveDiff(payload);
          markSavedSnapshotClean();
          // 저장 후 TanStack Query 캐시 무효화 → 다음 로드 시 DB에서 최신 데이터 사용
          queryClient.invalidateQueries({ queryKey: surveyKeys.detail(survey.id) });
          queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
          return result;
        })
        .catch((error: unknown) => {
          // 실패 시 스냅샷을 현재 changeset에 merge back
          useSurveyBuilderStore.getState().mergeChangesBack(snapshot);
          const err = error instanceof Error ? error : new Error('설문 저장 실패');
          console.error('설문 저장 실패:', err);
          setSaveError(err);
          throw err;
        });
    });
  }, [markSavedSnapshotClean, queryClient, saveDiff]);

  /**
   * 조건 리매핑 결과만 영속하는 스코프 저장 — 전체 saveSurvey 와 달리 대상 질문의
   * updated 와 (그룹 조건이 바뀐 경우에만) 메타데이터만 전송하고, 나머지 pending
   * 변경(추가/삭제/순서/타 질문 수정)은 changeset 에 되돌려 사용자가 명시적으로
   * 저장하기 전까지 그대로 남긴다. 옵션 value 리매핑 자동 저장이 빌더에 대기 중인
   * 무관한 변경(예: 그룹 삭제)까지 함께 커밋해 버리는 부작용을 막는다.
   */
  const saveSurveyScoped = useCallback(
    async (scope: { questionIds: string[] }) => {
      if (!useSurveyBuilderStore.getState().currentSurvey.id) {
        console.error('설문 ID가 없습니다.');
        return null;
      }

      return enqueueBuilderSave(() => {
        const store = useSurveyBuilderStore.getState();
        if (!store.isDirty) {
          return Promise.resolve({ surveyId: store.currentSurvey.id });
        }

        setSaveError(null);

        const snapshot = store.snapshotChanges();

        // 스코프 분할: in-scope 만 저장, out-of-scope 는 즉시 changeset 에 복귀
        const scopeIds = new Set(scope.questionIds);
        const inUpdated: Record<string, boolean> = {};
        const outUpdated: Record<string, boolean> = {};
        for (const id of Object.keys(snapshot.questionChanges.updated)) {
          if (scopeIds.has(id)) inUpdated[id] = true;
          else outUpdated[id] = true;
        }
        // 메타데이터(제목·설정·그룹 전체)는 스코프 저장으로 절대 전송하지 않는다 —
        // 전역 metadata dirty 를 소비하면 미저장 제목 변경·그룹 삭제까지 동반 커밋된다.
        // 리매핑된 그룹 조건은 호출측이 groups.update RPC 로 개별 영속한다.
        const inScope = {
          questionChanges: { added: {}, updated: inUpdated, deleted: {}, reordered: false },
          isMetadataDirty: false,
        };
        const outOfScope = {
          questionChanges: {
            added: snapshot.questionChanges.added,
            updated: outUpdated,
            deleted: snapshot.questionChanges.deleted,
            reordered: snapshot.questionChanges.reordered,
          },
          isMetadataDirty: snapshot.isMetadataDirty,
        };
        useSurveyBuilderStore.getState().mergeChangesBack(outOfScope);

        return Promise.resolve()
          .then(async () => {
            const survey = useSurveyBuilderStore.getState().currentSurvey;
            const payload = buildSurveyDiffPayload(survey, inScope);

            if (!payload) {
              markSavedSnapshotClean();
              return { surveyId: survey.id };
            }

            const result = await saveDiff(payload);
            // out-of-scope 가 남아 있으면 markSavedSnapshotClean 이 isDirty 를 유지한다
            markSavedSnapshotClean();
            queryClient.invalidateQueries({ queryKey: surveyKeys.detail(survey.id) });
            queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
            return result;
          })
          .catch((error: unknown) => {
            useSurveyBuilderStore.getState().mergeChangesBack(inScope);
            const err = error instanceof Error ? error : new Error('설문 저장 실패');
            console.error('설문 스코프 저장 실패:', err);
            setSaveError(err);
            throw err;
          });
      });
    },
    [markSavedSnapshotClean, queryClient, saveDiff],
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
    saveSurveyScoped,
    loadSurvey,
    createNewSurvey,
    startTransition,
  };
}
