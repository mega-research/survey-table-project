import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { getQuestionGroupsBySurvey } from '@/data/surveys';
import { db } from '@/db';
import { NewQuestionGroup, questionGroups, questions } from '@/db/schema';
import { generateId, isValidUUID } from '@/lib/utils';

import type {
  CreateQuestionGroupInput,
  GroupRow,
  UpdateQuestionGroupData,
} from '../../domain/question-group';

// 원본: src/actions/question-group-actions.ts
// requireAuth/revalidatePath 는 procedure(authed) + 소비처 router.refresh 로 대체.
// update 는 원본의 동적 partial spread(`{...data, updatedAt}`)가 고유 동작이므로 보존한다
// (불변식 A 의 explicit set 규칙은 survey-save-actions 전용). reorder 0-based 보존.

/** 질문 그룹 생성 — sibling maxOrder 계산 후 insert. */
export async function createQuestionGroup(data: CreateQuestionGroupInput): Promise<GroupRow> {
  const siblingGroups = await getQuestionGroupsBySurvey(data.surveyId);
  const filteredGroups = siblingGroups.filter((g) =>
    data.parentGroupId ? g.parentGroupId === data.parentGroupId : !g.parentGroupId,
  );

  const maxOrder = filteredGroups.length > 0 ? Math.max(...filteredGroups.map((g) => g.order)) : -1;

  const newGroup: NewQuestionGroup = {
    id: data.id || generateId(),
    surveyId: data.surveyId,
    name: data.name,
    description: data.description,
    parentGroupId: data.parentGroupId,
    order: data.order ?? maxOrder + 1,
    color: data.color,
  };

  const [group] = await db.insert(questionGroups).values(newGroup).returning();

  if (!group) throw new Error('질문 그룹 생성에 실패했습니다.');
  return group as GroupRow;
}

/**
 * 질문 그룹 업데이트 — 받은 partial 을 그대로 set(원본 spread 동작 보존).
 *
 * WS-2 IDOR 봉인: WHERE 에 surveyId 를 함께 걸어, 다른 설문 소속 그룹은
 * 영향 0행이 되어 update 가 실패한다.
 */
export async function updateQuestionGroup(
  groupId: string,
  surveyId: string,
  data: UpdateQuestionGroupData,
): Promise<GroupRow> {
  const [updated] = await db
    .update(questionGroups)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(questionGroups.id, groupId), eq(questionGroups.surveyId, surveyId)))
    .returning();

  if (!updated) throw new Error('질문 그룹 업데이트에 실패했습니다.');
  return updated as GroupRow;
}

/**
 * 질문 그룹 삭제 (메모리 기반 최적화) — 자손 재귀 수집 + 질문 ungroup.
 *
 * WS-2 IDOR 봉인: 타깃 그룹 조회를 surveyId 스코프로 한정해, 다른 설문 소속이면
 * 0행으로 short-circuit 한다. 자손 재귀/하위질문 ungroup/그룹 삭제 모두 surveyId
 * 스코프 안에서만 일어난다(allGroups 가 input surveyId 로 한정되고, 파괴적 쿼리
 * WHERE 에도 surveyId 를 함께 건다).
 */
export async function deleteQuestionGroup(
  groupId: string,
  surveyId: string,
): Promise<{ ok: true }> {
  const targetGroup = await db.query.questionGroups.findFirst({
    where: and(eq(questionGroups.id, groupId), eq(questionGroups.surveyId, surveyId)),
  });

  if (!targetGroup) return { ok: true as const };

  const allGroups = await db.query.questionGroups.findMany({
    where: eq(questionGroups.surveyId, surveyId),
  });

  const findDescendantIds = (parentId: string): string[] => {
    const children = allGroups.filter((g) => g.parentGroupId === parentId);
    let ids = children.map((c) => c.id);
    for (const child of children) {
      ids = [...ids, ...findDescendantIds(child.id)];
    }
    return ids;
  };

  const allGroupIdsToDelete = [groupId, ...findDescendantIds(groupId)];

  // 질문은 ungroup 후 살아남으므로 이미지를 삭제하지 않음 (삭제하면 404)
  if (allGroupIdsToDelete.length > 0) {
    await db
      .update(questions)
      .set({ groupId: null, updatedAt: new Date() })
      .where(
        and(eq(questions.surveyId, surveyId), inArray(questions.groupId, allGroupIdsToDelete)),
      );
  }

  if (allGroupIdsToDelete.length > 0) {
    await db
      .delete(questionGroups)
      .where(
        and(
          eq(questionGroups.surveyId, surveyId),
          inArray(questionGroups.id, allGroupIdsToDelete),
        ),
      );
  }

  return { ok: true as const };
}

/** [최적화] 그룹 순서 변경 (최상위 그룹만) — order 는 0-based(index). 변경된 행만 update. */
export async function reorderGroups(
  surveyId: string,
  groupIds: string[],
): Promise<{ ok: true }> {
  const validGroupIds = groupIds.filter((id) => isValidUUID(id));
  if (validGroupIds.length === 0) return { ok: true as const };

  const currentGroups = await db.query.questionGroups.findMany({
    where: eq(questionGroups.surveyId, surveyId),
    columns: {
      id: true,
      order: true,
    },
  });

  const currentOrderMap = new Map(currentGroups.map((g) => [g.id, g.order]));

  // WS-2 IDOR 봉인: 유효 groupId 전부가 해당 설문 소속이어야 한다. 누락분이 있으면
  // 타 설문 소속(또는 미존재) id 가 섞인 것이므로 전체 reorder 를 거부한다.
  const allBelong = validGroupIds.every((id) => currentOrderMap.has(id));
  if (!allBelong) {
    throw new Error('다른 설문 소속 그룹이 reorder 요청에 포함되어 거부되었습니다.');
  }

  const updates: Promise<unknown>[] = [];

  validGroupIds.forEach((id, index) => {
    const currentOrder = currentOrderMap.get(id);

    if (currentOrder !== index) {
      updates.push(
        db
          .update(questionGroups)
          .set({ order: index, updatedAt: new Date() })
          .where(and(eq(questionGroups.id, id), eq(questionGroups.surveyId, surveyId))),
      );
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
  }

  return { ok: true as const };
}
