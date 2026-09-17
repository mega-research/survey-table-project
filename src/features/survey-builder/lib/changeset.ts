import type { Question } from '@/types/survey';

// 질문 변경 추적을 위한 changeset
export interface QuestionChangeset {
  updated: Record<string, boolean>;  // 수정된 질문 ID
  added: Record<string, boolean>;    // 새로 추가된 질문 ID
  deleted: Record<string, boolean>;  // 삭제된 질문 ID
  reordered: boolean;                // 순서 변경 여부
}

/** 빈 changeset 생성 */
export const emptyChangeset = (): QuestionChangeset => ({
  updated: {},
  added: {},
  deleted: {},
  reordered: false,
});

/** changeset 에 실제 변경분이 하나라도 있는지 여부 (순수 함수) */
export function changesetHasChanges(changeset: QuestionChangeset): boolean {
  return (
    Object.keys(changeset.added).length > 0 ||
    Object.keys(changeset.updated).length > 0 ||
    Object.keys(changeset.deleted).length > 0 ||
    changeset.reordered
  );
}

/**
 * 저장 실패 시 보관해 둔 snapshot(pending)을 현재 changeset(current)에 merge back 한 결과를 반환.
 *
 * 순수 함수: 입력을 변형하지 않고 새 changeset 을 만들어 반환한다.
 * 머지/상쇄 순서는 store 인라인 구현과 1:1로 동일하다.
 *   1. pending.added → current (단, current 에서 삭제된 건 제외)
 *   2. pending.updated → current (삭제/추가 대상 제외)
 *   3. pending.deleted → current (저장 중 다시 추가된 경우 상쇄, updated 는 제거)
 *   4. pending.reordered 면 reordered 유지
 *
 * isMetadataDirty / isDirty 같은 store 의 다른 필드 복원은 호출 측 책임이다.
 */
export function mergeChangesets(
  current: QuestionChangeset,
  snapshot: { questionChanges: QuestionChangeset; isMetadataDirty: boolean },
): QuestionChangeset {
  const pending = snapshot.questionChanges;

  // current 를 변형하지 않도록 얕은 복제로 시작 (record 는 새 객체)
  const merged: QuestionChangeset = {
    updated: { ...current.updated },
    added: { ...current.added },
    deleted: { ...current.deleted },
    reordered: current.reordered,
  };

  // pending.added → merged 에 merge (단, merged 에서 삭제된 건 제외)
  for (const id in pending.added) {
    if (!merged.deleted[id]) {
      merged.added[id] = true;
    }
  }
  // pending.updated → merged 에 merge (삭제/추가 대상 제외)
  for (const id in pending.updated) {
    if (!merged.deleted[id] && !merged.added[id]) {
      merged.updated[id] = true;
    }
  }
  // pending.deleted → merged 에 merge
  for (const id in pending.deleted) {
    if (merged.added[id]) {
      // 저장 중 다시 추가된 경우 → 상쇄
      delete merged.added[id];
    } else {
      merged.deleted[id] = true;
    }
    delete merged.updated[id];
  }

  if (pending.reordered) {
    merged.reordered = true;
  }

  return merged;
}

/**
 * SPSS 코드 재생성 후 코드가 바뀐 기존 질문들의 id 목록을 계산.
 * added 상태인 질문은 이미 전체 전송 대상이므로 제외한다.
 *
 * 순수 함수: 입력을 변형하지 않고 변경된 질문 id 배열을 반환한다.
 */
export function computeSpssChangedQuestions(
  questions: Pick<Question, 'id' | 'questionCode'>[],
  oldCodes: Map<string, string | undefined>,
  addedIds: Record<string, boolean>,
): string[] {
  const changed: string[] = [];
  for (const q of questions) {
    if (addedIds[q.id]) continue;
    if (oldCodes.get(q.id) !== q.questionCode) {
      changed.push(q.id);
    }
  }
  return changed;
}
