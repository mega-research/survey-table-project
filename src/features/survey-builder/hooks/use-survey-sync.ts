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
 * 설문이 바뀌면 기다리던 저장은 거부한다(`isStillEditing`) — 스토어가 이미 남의 설문이다.
 * 응답 없는 요청은 기한에 끊는다(`withSaveDeadline`) — 안 그러면 줄이 영영 선다.
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
 * 저장 요청 하나의 기한. 운영 30일(275건) 최댓값이 1.8초라, 60초면 느린 것이 아니라 끊긴 것이다.
 * 기한이 없으면 끝나지 않는 요청 하나가 줄을 영영 세워 둔다 — 줄이 모듈에 하나라 화면을 옮겨도 풀리지 않는다.
 */
const BUILDER_SAVE_TIMEOUT_MS = 60_000;

/** 기한 안에 끝나지 않으면 요청을 중단하고 실패로 끝낸다. 늦게 온 응답은 버려진다. */
function withSaveDeadline<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new Error(
          '저장 요청이 60초 동안 응답하지 않아 중단했습니다. 네트워크를 확인한 뒤 다시 저장해 주세요.',
        ),
      );
    }, BUILDER_SAVE_TIMEOUT_MS);
  });
  return Promise.race([run(controller.signal), deadline]).finally(() => clearTimeout(timer));
}

/**
 * 스토어가 아직 그 설문을 들고 있는가. 저장을 부른 뒤(줄에서 기다리는 동안·요청이 서버에 가 있는 동안)
 * 화면이 다른 설문으로 바뀌면 스토어의 changeset 은 이미 남의 것이다 — 읽어 저장해도, 결과를 적어도,
 * 실패한 변경을 되돌려 넣어도 안 된다.
 */
function isStillEditing(surveyId: string): boolean {
  return useSurveyBuilderStore.getState().currentSurvey.id === surveyId;
}

function supersededError(): Error {
  return new Error('저장을 기다리는 사이 다른 설문으로 바뀌어 저장하지 않았습니다.');
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
      withSaveDeadline((signal) => client.surveyBuilder.save.saveDiff(payload, { signal })),
  });
  const [saveError, setSaveError] = useState<Error | null>(null);

  // Diff 기반 저장: 변경분만 서버에 전송
  const saveSurvey = useCallback(async () => {
    // 저장을 부른 순간의 설문 — 차례가 왔을 때·요청이 끝났을 때 스토어가 아직 이 설문인지 대조한다.
    const surveyId = useSurveyBuilderStore.getState().currentSurvey.id;
    if (!surveyId) {
      console.error('설문 ID가 없습니다.');
      return null;
    }

    return enqueueBuilderSave(() => {
      if (!isStillEditing(surveyId)) return Promise.reject(supersededError());
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
          // 요청이 서버에 가 있는 동안 설문이 바뀌었으면 스토어는 남의 것이다 — 미저장 표시를 건드리지 않는다.
          if (isStillEditing(surveyId)) markSavedSnapshotClean();
          // 저장 후 TanStack Query 캐시 무효화 → 다음 로드 시 DB에서 최신 데이터 사용
          queryClient.invalidateQueries({ queryKey: surveyKeys.detail(survey.id) });
          queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
          return result;
        })
        .catch((error: unknown) => {
          // 실패 시 스냅샷을 현재 changeset에 merge back — 스토어가 아직 이 설문일 때만.
          // 다른 설문으로 바뀌었으면 이 변경은 그 설문의 것이 아니다.
          if (isStillEditing(surveyId)) {
            useSurveyBuilderStore.getState().mergeChangesBack(snapshot);
          }
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
      const surveyId = useSurveyBuilderStore.getState().currentSurvey.id;
      if (!surveyId) {
        console.error('설문 ID가 없습니다.');
        return null;
      }

      return enqueueBuilderSave(() => {
        if (!isStillEditing(surveyId)) return Promise.reject(supersededError());
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
            if (isStillEditing(surveyId)) markSavedSnapshotClean();
            queryClient.invalidateQueries({ queryKey: surveyKeys.detail(survey.id) });
            queryClient.invalidateQueries({ queryKey: surveyKeys.lists() });
            return result;
          })
          .catch((error: unknown) => {
            if (isStillEditing(surveyId)) {
              useSurveyBuilderStore.getState().mergeChangesBack(inScope);
            }
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
