'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { FolderPlus } from 'lucide-react';

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { client } from '@/shared/lib/rpc';
import { useEnsureSurveyInDb } from '@/hooks/use-ensure-survey-in-db';
import { isUUID } from '@/lib/survey-url';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import { GroupNameDesign, QuestionConditionGroup, QuestionGroup } from '@/types/survey';

import { GroupCreateModal } from './group-manager/group-create-modal';
import { GroupEditModal } from './group-manager/group-edit-modal';
import { canBeParentOf } from './group-manager/group-helpers';
import { SortableGroupItem } from './group-manager/group-item';

interface GroupManagerProps {
  className?: string;
}

export function GroupManager({ className }: GroupManagerProps) {
  const {
    addGroup,
    updateGroup,
    clearGroupParent,
    clearGroupNameDesign,
    deleteGroup,
    reorderGroups,
    toggleGroupCollapse,
  } = useSurveyBuilderStore(
    useShallow((s) => ({
      addGroup: s.addGroup,
      updateGroup: s.updateGroup,
      clearGroupParent: s.clearGroupParent,
      clearGroupNameDesign: s.clearGroupNameDesign,
      deleteGroup: s.deleteGroup,
      reorderGroups: s.reorderGroups,
      toggleGroupCollapse: s.toggleGroupCollapse,
    })),
  );
  const groups = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.groups));
  const questions = useSurveyBuilderStore(useShallow((s) => s.currentSurvey.questions));
  const surveyId = useSurveyBuilderStore((s) => s.currentSurvey.id);
  const ensureSurvey = useEnsureSurveyInDb();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<QuestionGroup | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [parentGroupIdForNew, setParentGroupIdForNew] = useState<string | undefined>(undefined);
  const [parentGroupIdForEdit, setParentGroupIdForEdit] = useState<string | undefined>(undefined);
  const [hideNameForEdit, setHideNameForEdit] = useState(false);
  const [nameDesignForEdit, setNameDesignForEdit] = useState<GroupNameDesign | undefined>(undefined);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [, setActiveId] = useState<string | null>(null);
  const [, setOverId] = useState<string | null>(null);

  const groupsOrEmpty = useMemo(() => groups || [], [groups]);

  // Store의 collapsed 상태와 expandedGroups 동기화
  useEffect(() => {
    if (groupsOrEmpty.length === 0) return;
    setExpandedGroups(() => {
      const next = new Set<string>();
      for (const g of groupsOrEmpty) {
        if (!g.collapsed) next.add(g.id);
      }
      // 기존에 없던 그룹이 삭제된 경우 자동 cleanup (prev에서 groupIds에 없는 건 제거됨)
      return next;
    });
  }, [groupsOrEmpty]);

  // 모달이 열려있는 동안 groups가 업데이트되면 editingGroup도 업데이트
  useEffect(() => {
    if (isEditModalOpen && editingGroup?.id) {
      const latestGroup = groupsOrEmpty.find((g) => g.id === editingGroup.id);
      if (latestGroup) {
        // displayCondition이 다르거나 다른 필드가 업데이트된 경우
        const hasChanges =
          latestGroup.displayCondition !== editingGroup.displayCondition ||
          latestGroup.name !== editingGroup.name ||
          latestGroup.description !== editingGroup.description ||
          latestGroup.parentGroupId !== editingGroup.parentGroupId;

        if (hasChanges) {
          setEditingGroup(latestGroup);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditModalOpen, editingGroup?.id, groupsOrEmpty]);

  // 최상위 그룹만 필터링 (parentGroupId가 없는 것들)
  const topLevelGroups = useMemo(
    () => groupsOrEmpty.filter((g) => !g.parentGroupId).sort((a, b) => a.order - b.order),
    [groupsOrEmpty],
  );

  // 특정 그룹의 하위 그룹들 가져오기
  const getSubGroups = useCallback(
    (parentId: string) => {
      return groupsOrEmpty.filter((g) => g.parentGroupId === parentId).sort((a, b) => a.order - b.order);
    },
    [groupsOrEmpty],
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // 각 그룹에 직접 속한 질문 개수 계산 (메모이제이션)
  const questionCountMap = useMemo(() => {
    const map = new Map<string, number>();
    groupsOrEmpty.forEach((group) => {
      const count = questions.filter((q) => q.groupId === group.id).length;
      map.set(group.id, count);
    });
    return map;
  }, [groupsOrEmpty, questions]);

  // 재귀적으로 그룹과 모든 하위 그룹의 질문 개수 합계 계산 (메모이제이션)
  const getTotalQuestionCount = useCallback(
    (groupId: string): number => {
      const directCount = questionCountMap.get(groupId) || 0;
      const subGroups = getSubGroups(groupId);
      const subGroupsCount = subGroups.reduce((sum, subGroup) => {
        return sum + getTotalQuestionCount(subGroup.id);
      }, 0);
      return directCount + subGroupsCount;
    },
    [questionCountMap, getSubGroups],
  );

  // 재귀적으로 모든 하위 그룹 개수 계산 (직접 하위 + 하위의 하위) (메모이제이션)
  const subGroupCountMap = useMemo(() => {
    const map = new Map<string, number>();

    const calculateCount = (groupId: string): number => {
      if (map.has(groupId)) {
        return map.get(groupId)!;
      }
      const directSubGroups = getSubGroups(groupId);
      const directCount = directSubGroups.length;
      const nestedCount = directSubGroups.reduce((sum, subGroup) => {
        return sum + calculateCount(subGroup.id);
      }, 0);
      const total = directCount + nestedCount;
      map.set(groupId, total);
      return total;
    };

    // 모든 그룹에 대해 계산
    groupsOrEmpty.forEach((group) => {
      if (!map.has(group.id)) {
        calculateCount(group.id);
      }
    });

    return map;
  }, [groupsOrEmpty, getSubGroups]);

  const getTotalSubGroupCount = useCallback(
    (groupId: string): number => {
      return subGroupCountMap.get(groupId) || 0;
    },
    [subGroupCountMap],
  );

  const handleCreateGroup = async () => {
    if (groupName.trim()) {
      let createdGroupId: string | undefined;

      // 새 그룹 order: 질문 + 형제그룹 통합 공간의 max+1 (append 보장).
      // DB(create)와 로컬 양쪽에 같은 값을 써야 refresh 후에도 순서가 유지된다.
      // (order 를 create 에 안 넘기면 서버 maxOrder 가 형제 질문을 무시해 interleave 된다.)
      const orderSiblingGroups = groupsOrEmpty.filter((g) => g.parentGroupId === parentGroupIdForNew);
      const orderSiblingQuestions = parentGroupIdForNew
        ? questions.filter((q) => q.groupId === parentGroupIdForNew)
        : [];
      const orderPool = [
        ...orderSiblingGroups.map((g) => g.order),
        ...orderSiblingQuestions.map((q) => q.order),
      ];
      const newGroupOrder = (orderPool.length > 0 ? Math.max(...orderPool) : -1) + 1;

      // DB에 그룹 저장
      if (surveyId && isUUID(surveyId)) {
        try {
          await ensureSurvey();
          const createdGroup = await client.surveyBuilder.groups.create({
            surveyId: surveyId,
            name: groupName.trim(),
            ...(groupDescription.trim() ? { description: groupDescription.trim() } : {}),
            ...(parentGroupIdForNew ? { parentGroupId: parentGroupIdForNew } : {}),
            order: newGroupOrder,
          });
          if (createdGroup) createdGroupId = createdGroup.id;
        } catch (error) {
          console.error('그룹 생성 실패:', error);
          toast.error('그룹 생성에 실패했습니다. 다시 시도해주세요.');
          return;
        }
      }

      // 로컬 스토어 업데이트
      if (createdGroupId && isUUID(createdGroupId)) {
        // DB에서 생성된 그룹의 UUID를 사용하여 직접 추가
        // order 는 위에서 계산한 newGroupOrder 를 재사용(create 에 넘긴 값과 동일 → DB·로컬 일치).
        const newGroup: QuestionGroup = {
          id: createdGroupId,
          surveyId: surveyId!,
          name: groupName.trim(),
          ...(groupDescription.trim() ? { description: groupDescription.trim() } : {}),
          order: newGroupOrder,
          ...(parentGroupIdForNew ? { parentGroupId: parentGroupIdForNew } : {}),
          collapsed: false,
        };

        // 스토어에 직접 추가 (updateGroup을 사용하여 그룹 추가)
        // updateGroup은 기존 그룹을 업데이트하므로, 직접 스토어 상태 업데이트
        const { currentSurvey: current } = useSurveyBuilderStore.getState();
        useSurveyBuilderStore.setState({
          currentSurvey: {
            ...current,
            groups: [...(current.groups || []), newGroup],
            updatedAt: new Date(),
          },
          isDirty: true,
        });
      } else {
        // UUID가 없으면 임시 그룹으로 추가
        addGroup(groupName.trim(), groupDescription.trim() || undefined, parentGroupIdForNew);
      }

      setGroupName('');
      setGroupDescription('');
      setParentGroupIdForNew(undefined);
      setIsCreateModalOpen(false);
      // 그룹 생성은 이미 createQuestionGroup API로 저장됨
    }
  };

  const handleOpenCreateModal = (parentId?: string) => {
    setParentGroupIdForNew(parentId);
    setIsCreateModalOpen(true);
  };

  const handleToggleExpand = (groupId: string) => {
    toggleGroupCollapse(groupId);
    setExpandedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  const handleEditGroup = (group: QuestionGroup) => {
    // groups에서 최신 그룹 정보 가져오기 (displayCondition 포함)
    const latestGroup = groupsOrEmpty.find((g) => g.id === group.id) || group;
    setEditingGroup(latestGroup);
    setGroupName(latestGroup.name);
    setGroupDescription(latestGroup.description || '');
    setParentGroupIdForEdit(latestGroup.parentGroupId);
    setHideNameForEdit(latestGroup.hideName ?? false);
    setNameDesignForEdit(latestGroup.nameDesign);
    setIsEditModalOpen(true);
  };

  const handleGroupConditionUpdate = (conditionGroup: QuestionConditionGroup | undefined) => {
    if (editingGroup) {
      updateGroup(editingGroup.id, { ...(conditionGroup !== undefined ? { displayCondition: conditionGroup } : {}) });

      // DB에 저장 (그룹 ID가 UUID인 경우에만)
      if (surveyId && isUUID(surveyId) && isUUID(editingGroup.id)) {
        ensureSurvey().then(() =>
          client.surveyBuilder.groups
            .update({
              groupId: editingGroup.id,
              surveyId,
              data: {
                ...(conditionGroup !== undefined ? { displayCondition: conditionGroup } : {}),
              },
            })
            .catch((error) => {
              console.error('그룹 표시 조건 저장 실패:', error);
            }),
        );
      }
    }
  };

  const handleUpdateGroup = async () => {
    if (editingGroup && groupName.trim()) {
      const oldParentGroupId = editingGroup.parentGroupId;
      const newParentGroupId = parentGroupIdForEdit;

      // groups에서 최신 그룹 정보 확인
      const latestGroup = groupsOrEmpty.find((g) => g.id === editingGroup.id);
      const finalDisplayCondition = latestGroup?.displayCondition;

      // 상위 그룹이 변경된 경우
      if (oldParentGroupId !== newParentGroupId) {
        // 순환 참조 체크: newParentGroupId가 editingGroup의 하위 그룹이 될 수 있는지 확인
        if (newParentGroupId && !canBeParentOf(newParentGroupId, editingGroup.id, groupsOrEmpty)) {
          toast.error('순환 참조 방지: 선택한 그룹을 상위 그룹으로 설정할 수 없습니다.');
          return;
        }

        // 새로운 상위 그룹의 하위 그룹들 중 마지막 순서 계산
        let newOrder = 0;
        if (newParentGroupId) {
          const newSiblings = groupsOrEmpty.filter(
            (g) => g.parentGroupId === newParentGroupId && g.id !== editingGroup.id,
          );
          newOrder = newSiblings.length > 0 ? Math.max(...newSiblings.map((g) => g.order)) + 1 : 0;
        } else {
          // 최상위로 이동하는 경우
          const topLevelSiblings = groupsOrEmpty.filter(
            (g) => !g.parentGroupId && g.id !== editingGroup.id,
          );
          newOrder =
            topLevelSiblings.length > 0 ? Math.max(...topLevelSiblings.map((g) => g.order)) + 1 : 0;
        }

        // 최상위로 이동(newParentGroupId === undefined) 시 parentGroupId 를 명시적으로 해제한다.
        // 키를 누락하면 store 의 Object.assign 이 옛 parentGroupId 를 그대로 둬 로컬 트리만
        // 중첩 상태로 남고 DB(top-level)와 desync 된다. exactOptionalPropertyTypes 때문에
        // undefined 값을 직접 전달할 수 없어 별도 partial 로 분기한다.
        if (newParentGroupId !== undefined) {
          updateGroup(editingGroup.id, {
            name: groupName.trim(),
            ...(groupDescription.trim() ? { description: groupDescription.trim() } : {}),
            parentGroupId: newParentGroupId,
            order: newOrder,
            hideName: hideNameForEdit,
          });
        } else {
          updateGroup(editingGroup.id, {
            name: groupName.trim(),
            ...(groupDescription.trim() ? { description: groupDescription.trim() } : {}),
            order: newOrder,
            hideName: hideNameForEdit,
          });
          clearGroupParent(editingGroup.id);
        }

        // DB에 저장 (그룹 ID가 UUID인 경우에만)
        if (
          surveyId &&
          isUUID(surveyId) &&
          isUUID(editingGroup.id) &&
          (!newParentGroupId || isUUID(newParentGroupId))
        ) {
          try {
            await ensureSurvey();
            await client.surveyBuilder.groups.update({
              groupId: editingGroup.id,
              surveyId,
              data: {
                name: groupName.trim(),
                ...(groupDescription.trim() ? { description: groupDescription.trim() } : {}),
                parentGroupId: newParentGroupId ?? null,
                order: newOrder,
                hideName: hideNameForEdit,
                nameDesign: nameDesignForEdit ?? null,
                ...(finalDisplayCondition !== undefined ? { displayCondition: finalDisplayCondition } : {}),
              },
            });
          } catch (error) {
            console.error('그룹 업데이트 저장 실패:', error);
          }
        }

        // 상위 그룹이 변경되면 해당 그룹을 펼침
        if (newParentGroupId) {
          setExpandedGroups((prev) => new Set(prev).add(newParentGroupId));
        }
      } else {
        // 이름/설명/표시 옵션만 변경된 경우
        updateGroup(editingGroup.id, {
          name: groupName.trim(),
          ...(groupDescription.trim() ? { description: groupDescription.trim() } : {}),
          hideName: hideNameForEdit,
        });

        // DB에 저장 (그룹 ID가 UUID인 경우에만)
        if (surveyId && isUUID(surveyId) && isUUID(editingGroup.id)) {
          try {
            await ensureSurvey();
            await client.surveyBuilder.groups.update({
              groupId: editingGroup.id,
              surveyId,
              data: {
                name: groupName.trim(),
                ...(groupDescription.trim() ? { description: groupDescription.trim() } : {}),
                hideName: hideNameForEdit,
                nameDesign: nameDesignForEdit ?? null,
                ...(finalDisplayCondition !== undefined ? { displayCondition: finalDisplayCondition } : {}),
              },
            });
          } catch (error) {
            console.error('그룹 업데이트 저장 실패:', error);
          }
        }
      }

      // 이름 디자인 로컬 반영: 값이 있으면 set, 없으면 기본값으로 초기화(키 삭제).
      // Object.assign 기반 updateGroup 으로는 undefined 전달/키 삭제가 불가하므로 분기한다.
      if (nameDesignForEdit) {
        updateGroup(editingGroup.id, { nameDesign: nameDesignForEdit });
      } else {
        clearGroupNameDesign(editingGroup.id);
      }

      setEditingGroup(null);
      setGroupName('');
      setGroupDescription('');
      setParentGroupIdForEdit(undefined);
      setHideNameForEdit(false);
      setNameDesignForEdit(undefined);
      setIsEditModalOpen(false);
      // 그룹 수정은 이미 updateQuestionGroup API로 저장됨
    }
  };

  const handleDeleteGroup = (groupId: string) => {
    const subGroups = getSubGroups(groupId);
    const message =
      subGroups.length > 0
        ? `이 그룹과 ${subGroups.length}개의 하위 그룹을 삭제하시겠습니까? (그룹에 속한 질문들은 그룹 없음 상태가 됩니다)`
        : '이 그룹을 삭제하시겠습니까? (그룹에 속한 질문들은 그룹 없음 상태가 됩니다)';

    if (!confirm(message)) return;

    // 로컬 스토어만 업데이트 — 저장 버튼 클릭 시 saveSurveyDiff가 그룹 배열 diff로 삭제 반영
    deleteGroup(groupId);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overIdValue = (event.over?.id as string) || null;
    setOverId(overIdValue);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    setActiveId(null);
    setOverId(null);

    if (!over || active.id === over.id) return;

    const draggedGroup = groupsOrEmpty.find((g) => g.id === active.id);
    const targetGroup = groupsOrEmpty.find((g) => g.id === over.id);

    if (!draggedGroup || !targetGroup) return;

    // 자기 자신으로는 이동 불가
    if (draggedGroup.id === targetGroup.id) return;

    // 대분류는 대분류끼리만 순서 변경 가능
    if (!draggedGroup.parentGroupId && !targetGroup.parentGroupId) {
      const sameLevelGroups = groupsOrEmpty
        .filter((g) => !g.parentGroupId)
        .sort((a, b) => a.order - b.order);

      const oldIndex = sameLevelGroups.findIndex((g) => g.id === draggedGroup.id);
      const newIndex = sameLevelGroups.findIndex((g) => g.id === targetGroup.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(sameLevelGroups, oldIndex, newIndex);
        const newGroupIds = newOrder.map((g) => g.id);
        reorderGroups(newGroupIds);

        // DB에 저장 (UUID인 그룹 ID만 필터링)
        if (surveyId && isUUID(surveyId)) {
          try {
            await ensureSurvey();
            const uuidGroupIds = newGroupIds.filter((id) => isUUID(id));
            if (uuidGroupIds.length > 0) {
              await client.surveyBuilder.groups.reorder({ surveyId, groupIds: uuidGroupIds });
            }
          } catch (error) {
            console.error('그룹 순서 저장 실패:', error);
          }
        }
        // 그룹 순서 변경은 이미 reorderGroups API로 저장됨
      }
      return;
    }

    // 소분류 순서는 질문 목록(SortableQuestionList)에서 인터리브 DnD로 관리
    if (draggedGroup.parentGroupId || targetGroup.parentGroupId) {
      return;
    }

    // 대분류와 소분류 간 이동 불가 (아무것도 하지 않음)
  };

  return (
    <div>
      {/* 고정 헤더 */}
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">📁 그룹 관리</h4>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => handleOpenCreateModal()}
        >
          <FolderPlus className="mr-1 h-3 w-3" />새 그룹
        </Button>
      </div>

      {/* 스크롤 가능한 그룹 리스트 */}
      <div className={`overflow-y-auto ${className || ''}`}>
        {topLevelGroups.length === 0 ? (
          <div className="py-6 text-center text-xs text-gray-400">
            <p>생성된 그룹이 없습니다</p>
            <p className="mt-1">그룹을 만들어 질문을 정리하세요</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={topLevelGroups.map((g) => g.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {topLevelGroups.map((group) => {
                  const subGroups = getSubGroups(group.id);
                  const isExpanded = expandedGroups.has(group.id);

                  return (
                    <div key={group.id}>
                      <SortableGroupItem
                        group={group}
                        questionCount={getTotalQuestionCount(group.id)}
                        subGroups={subGroups}
                        isExpanded={isExpanded}
                        onEdit={handleEditGroup}
                        onDelete={handleDeleteGroup}
                        onToggleExpand={handleToggleExpand}
                        onAddSubGroup={handleOpenCreateModal}
                        totalSubGroupCount={getTotalSubGroupCount(group.id)}
                      />

                      {/* 하위 그룹 렌더링 */}
                      {isExpanded && subGroups.length > 0 && (
                        <SortableContext
                          items={subGroups.map((g) => g.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="mt-2 ml-6 space-y-2 border-l-2 border-gray-200 pl-3">
                            {subGroups.map((subGroup) => {
                              return (
                                <div key={subGroup.id}>
                                  <SortableGroupItem
                                    group={subGroup}
                                    questionCount={getTotalQuestionCount(subGroup.id)}
                                    subGroups={[]}
                                    isExpanded={false}
                                    onEdit={handleEditGroup}
                                    onDelete={handleDeleteGroup}
                                    onToggleExpand={handleToggleExpand}
                                    onAddSubGroup={handleOpenCreateModal}
                                    totalSubGroupCount={getTotalSubGroupCount(subGroup.id)}
                                    disableDrag
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </SortableContext>
                      )}
                    </div>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* 그룹 생성 모달 */}
      <GroupCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setGroupName('');
          setGroupDescription('');
          setParentGroupIdForNew(undefined);
        }}
        onSubmit={handleCreateGroup}
        groupName={groupName}
        setGroupName={setGroupName}
        groupDescription={groupDescription}
        setGroupDescription={setGroupDescription}
        parentGroupId={parentGroupIdForNew}
        groups={groupsOrEmpty}
      />

      {/* 그룹 편집 모달 */}
      <GroupEditModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingGroup(null);
          setGroupName('');
          setGroupDescription('');
          setParentGroupIdForEdit(undefined);
          setHideNameForEdit(false);
          setNameDesignForEdit(undefined);
        }}
        onSubmit={handleUpdateGroup}
        editingGroup={editingGroup}
        groupName={groupName}
        setGroupName={setGroupName}
        groupDescription={groupDescription}
        setGroupDescription={setGroupDescription}
        parentGroupId={parentGroupIdForEdit}
        setParentGroupId={setParentGroupIdForEdit}
        hideName={hideNameForEdit}
        setHideName={setHideNameForEdit}
        nameDesign={nameDesignForEdit}
        setNameDesign={setNameDesignForEdit}
        topLevelGroups={topLevelGroups}
        allGroups={groupsOrEmpty}
        allQuestions={questions}
        onConditionUpdate={handleGroupConditionUpdate}
      />
    </div>
  );
}
