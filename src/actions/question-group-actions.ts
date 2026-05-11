'use server';

import { revalidatePath } from 'next/cache';

import { eq, inArray } from 'drizzle-orm';

import { getQuestionGroupsBySurvey } from '@/data/surveys';
import { db } from '@/db';
import { NewQuestionGroup, questionGroups, questions } from '@/db/schema';
import { requireAuth } from '@/lib/auth';
import { generateId, isValidUUID } from '@/lib/utils';
import type { QuestionConditionGroup } from '@/types/survey';

// ========================
// 질문 그룹 변경 액션 (Mutations)
// ========================

// 질문 그룹 생성
export async function createQuestionGroup(data: {
  surveyId: string;
  id?: string;
  name: string;
  description?: string;
  parentGroupId?: string;
  order?: number;
  color?: string;
}) {
  await requireAuth();

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

  revalidatePath(`/admin/surveys/${data.surveyId}`);
  return group;
}

// 질문 그룹 업데이트
export async function updateQuestionGroup(
  groupId: string,
  data: Partial<{
    name: string;
    description: string;
    order: number;
    parentGroupId: string | null;
    color: string;
    collapsed: boolean;
    displayCondition: QuestionConditionGroup | undefined;
  }>,
) {
  await requireAuth();

  const [updated] = await db
    .update(questionGroups)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(questionGroups.id, groupId))
    .returning();

  return updated;
}

// 질문 그룹 삭제 (메모리 기반 최적화)
export async function deleteQuestionGroup(groupId: string) {
  await requireAuth();

  const targetGroup = await db.query.questionGroups.findFirst({
    where: eq(questionGroups.id, groupId),
  });

  if (!targetGroup) return;

  const allGroups = await db.query.questionGroups.findMany({
    where: eq(questionGroups.surveyId, targetGroup.surveyId),
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
      .where(inArray(questions.groupId, allGroupIdsToDelete));
  }

  if (allGroupIdsToDelete.length > 0) {
    await db.delete(questionGroups).where(inArray(questionGroups.id, allGroupIdsToDelete));
  }
}

// [최적화] 그룹 순서 변경 (최상위 그룹만)
export async function reorderGroups(surveyId: string, groupIds: string[]) {
  await requireAuth();

  const validGroupIds = groupIds.filter((id) => isValidUUID(id));
  if (validGroupIds.length === 0) return;

  const currentGroups = await db.query.questionGroups.findMany({
    where: eq(questionGroups.surveyId, surveyId),
    columns: {
      id: true,
      order: true,
    },
  });

  const currentOrderMap = new Map(currentGroups.map((g) => [g.id, g.order]));
  const updates: Promise<any>[] = [];

  validGroupIds.forEach((id, index) => {
    const currentOrder = currentOrderMap.get(id);

    if (currentOrder !== index) {
      updates.push(
        db
          .update(questionGroups)
          .set({ order: index, updatedAt: new Date() })
          .where(eq(questionGroups.id, id)),
      );
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
    revalidatePath(`/admin/surveys/${surveyId}`);
  }
}
