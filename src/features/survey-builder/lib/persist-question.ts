'use client';

import { toast } from 'sonner';

import type { ConditionRemapScope } from '@/features/survey-builder/stores/survey-store';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { client } from '@/shared/lib/rpc';
import { omitKey } from '@/utils/omit-key';

// 컴포넌트 밖(모듈 최상위)이라 use* 식별자를 값으로 집어도 React Compiler 판정에 영향이 없다.
const readBuilderState = useSurveyBuilderStore.getState;
const writeBuilderState = useSurveyBuilderStore.setState;

/**
 * 미영속 질문의 CREATE 응답을 받은 직후의 스토어 뒷정리.
 *
 * 질문 편집 모달과 셀 내용 모달이 같은 순서를 각각 갖고 있었다 —
 * (1) questionChanges.added 에서 빼 다음 저장이 UPDATE 경로를 타게 하고,
 * (2) 서버가 다른 id 를 돌려줬으면 스토어 질문 id 를 스왑한 뒤
 * (3) 그 질문을 참조하는 조건(sourceQuestionId·expression 피연산자·branchRule goto)을
 *     새 id 로 리매핑한다.
 *
 * (3)을 빠뜨리면 참조가 temp id 로 끊긴다. 두 벌로 두면 한쪽만 고쳐질 수 있는 자리였다.
 *
 * 반환하는 스코프는 호출자가 remapScopes 에 모아 persistConditionRemaps 로 넘긴다.
 */
export function settleCreatedQuestion(
  localQuestionId: string,
  createdQuestionId: string | undefined,
): { newQuestionId: string | null; remapScope: ConditionRemapScope | null } {
  if (!createdQuestionId) return { newQuestionId: null, remapScope: null };

  // DB에 생성 완료 → added에서 제거 (다음 모달 저장 시 UPDATE 경로 사용)
  const remainingAdded = omitKey(readBuilderState().questionChanges.added, localQuestionId);
  writeBuilderState((state) => ({
    questionChanges: { ...state.questionChanges, added: remainingAdded },
  }));

  // id를 넘겼으므로 반환 id가 다를 경우에만 스토어 id 갱신
  if (createdQuestionId === localQuestionId) return { newQuestionId: null, remapScope: null };

  writeBuilderState((state) => ({
    currentSurvey: {
      ...state.currentSurvey,
      questions: state.currentSurvey.questions.map((q) =>
        q.id === localQuestionId ? { ...q, id: createdQuestionId } : q,
      ),
    },
  }));
  return {
    newQuestionId: createdQuestionId,
    remapScope: readBuilderState().remapQuestionRefs(localQuestionId, createdQuestionId),
  };
}

/**
 * 조건 리매핑이 실제 변경을 만들었으면 그 범위만 영속한다.
 *
 * 빌더에 대기 중인 무관한 pending(질문 추가/삭제, 그룹 삭제 등)은 건드리지 않는다.
 * 질문은 스코프 저장, 그룹 조건은 그룹 전용 RPC 로 개별 영속한다 — 전역 메타데이터
 * 저장에 실으면 미저장 제목 변경·그룹 삭제까지 동반 커밋된다.
 *
 * 두 모달이 이 34줄을 각각 갖고 있었고 catch 변수명 말고는 같았다.
 */
export async function persistConditionRemaps(
  remapScopes: ConditionRemapScope[],
  saveSurveyScoped: (scope: { questionIds: string[] }) => Promise<unknown>,
): Promise<void> {
  const remapQuestionIds = [...new Set(remapScopes.flatMap((s) => s.questionIds))];
  const remapGroupIds = [...new Set(remapScopes.flatMap((s) => s.groupIds))];
  if (remapQuestionIds.length === 0 && remapGroupIds.length === 0) return;

  try {
    if (remapGroupIds.length > 0) {
      const { currentSurvey } = readBuilderState();
      await Promise.all(
        remapGroupIds.map((groupId) => {
          const group = currentSurvey.groups?.find((g) => g.id === groupId);
          if (!group?.displayCondition) return null;
          return client.surveyBuilder.groups.update({
            groupId,
            surveyId: currentSurvey.id,
            data: { displayCondition: group.displayCondition },
          });
        }),
      );
    }
    if (remapQuestionIds.length > 0) {
      await saveSurveyScoped({ questionIds: remapQuestionIds });
    } else {
      // 그룹만 변경: RPC 영속이 끝났으므로 남은 변경 기준으로 dirty 재계산
      readBuilderState().markSavedSnapshotClean();
    }
  } catch (error) {
    if (remapGroupIds.length > 0) {
      // 그룹 RPC 실패 폴백 — 수동 저장(메타데이터 전체)으로 복구 가능하게 한다
      writeBuilderState({ isMetadataDirty: true, isDirty: true });
    }
    console.error('표시조건 리매핑 반영을 위한 설문 저장 실패:', error);
    toast.error('조건 리매핑 저장에 실패했습니다. 설문 저장 버튼으로 다시 저장해 주세요.');
  }
}
