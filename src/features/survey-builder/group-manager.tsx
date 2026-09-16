'use client';

import { useCallback, useMemo, useState } from 'react';

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
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { useEnsureSurveyInDb } from '@/features/survey-builder/hooks/use-ensure-survey-in-db';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';
import { runAsyncAction } from '@/utils/run-async-action';
import { isUUID } from '@/lib/survey-url';
import { client } from '@/shared/lib/rpc';
import { GroupNameDesign, QuestionConditionGroup, QuestionGroup } from '@/types/survey';

import { GroupCreateModal } from './group-manager/group-create-modal';
import { GroupEditModal } from './group-manager/group-edit-modal';
import { canBeParentOf } from './group-manager/group-helpers';
import { SortableGroupItem } from './group-manager/group-item';

interface GroupManagerProps {
  className?: string;
}

/**
 * 그룹 하위 트리의 질문 개수 합계.
 * 재귀 자기참조를 컴포넌트 밖에 두어 컴포넌트 안에 명명 함수 표현식이 생기지 않게 한다.
 */
function countQuestionsInSubtree(
  groupId: string,
  questionCountMap: Map<string, number>,
  getSubGroups: (parentId: string) => QuestionGroup[],
): number {
  const directCount = questionCountMap.get(groupId) || 0;
  const subGroupsCount = getSubGroups(groupId).reduce(
    (sum, subGroup) => sum + countQuestionsInSubtree(subGroup.id, questionCountMap, getSubGroups),
    0,
  );
  return directCount + subGroupsCount;
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
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [parentGroupIdForNew, setParentGroupIdForNew] = useState<string | undefined>(undefined);
  const [parentGroupIdForEdit, setParentGroupIdForEdit] = useState<string | undefined>(undefined);
  const [hideNameForEdit, setHideNameForEdit] = useState(false);
  const [nameDesignForEdit, setNameDesignForEdit] = useState<GroupNameDesign | undefined>(
    undefined,
  );
  const [, setActiveId] = useState<string | null>(null);
  const [, setOverId] = useState<string | null>(null);

  const groupsOrEmpty = useMemo(() => groups || [], [groups]);

  // 펼침은 store 의 collapsed 파생값이다 — 로컬 state 로 복제하면 groups 가 갱신될 때마다
  // 이펙트가 로컬을 store 기준으로 덮어써, 상위 그룹 변경 직후 펼쳐 둔 것이 도로 접혔다.
  // 삭제된 그룹은 목록에서 사라지므로 별도 cleanup 도 필요 없다.
  const expandedGroups = useMemo(() => {
    const next = new Set<string>();
    for (const g of groupsOrEmpty) {
      if (!g.collapsed) next.add(g.id);
    }
    return next;
  }, [groupsOrEmpty]);

  // 편집 대상도 store 파생값이다 — 로컬 state 로 객체를 복제하면 groups 갱신마다 이펙트가
  // 되맞춰야 하고(동기화를 빠뜨린 필드는 모달에서 조용히 stale 이 된다), 그 setState 가
  // 렌더 중 연쇄를 부른다. 펼침(expandedGroups)과 같은 꼴로 id 만 들고 파생한다.
  //
  // 편집 모달의 열림 여부도 이 값이 겸한다. GroupEditModal 은 editingGroup 이 null 이면
  // Dialog 를 만들기 전에 null 을 돌려주므로(그쪽 early return), 열림을 나타내는 boolean 을
  // 따로 들어도 화면에 보이는 것은 달라지지 않고 손으로 맞춰야 할 출처만 하나 늘어난다.
  const editingGroup = useMemo(
    () => groupsOrEmpty.find((g) => g.id === editingGroupId) ?? null,
    [groupsOrEmpty, editingGroupId],
  );

  // 최상위 그룹만 필터링 (parentGroupId가 없는 것들)
  const topLevelGroups = useMemo(
    () => groupsOrEmpty.filter((g) => !g.parentGroupId).sort((a, b) => a.order - b.order),
    [groupsOrEmpty],
  );

  // 특정 그룹의 하위 그룹들 가져오기
  const getSubGroups = useCallback(
    (parentId: string) => {
      return groupsOrEmpty
        .filter((g) => g.parentGroupId === parentId)
        .sort((a, b) => a.order - b.order);
    },
    [groupsOrEmpty],
  );

  /**
   * 하위 그룹 목록 재귀 렌더 — 하위 그룹의 하위 그룹도 같은 모양으로 들여쓴다.
   * 최상위만 드래그 정렬 대상이라(handleDragEnd 규칙) 하위 단계는 disableDrag.
   */
  const renderSubGroups = (parentId: string): React.ReactNode => {
    const subGroups = getSubGroups(parentId);
    if (subGroups.length === 0) return null;
    return (
      <SortableContext items={subGroups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
        <div className="mt-2 ml-6 space-y-2 border-l-2 border-gray-200 pl-3">
          {subGroups.map((subGroup) => (
            <div key={subGroup.id}>
              <SortableGroupItem
                group={subGroup}
                questionCount={getTotalQuestionCount(subGroup.id)}
                subGroups={getSubGroups(subGroup.id)}
                isExpanded={expandedGroups.has(subGroup.id)}
                onEdit={handleEditGroup}
                onDelete={handleDeleteGroup}
                onToggleExpand={handleToggleExpand}
                onAddSubGroup={handleOpenCreateModal}
                totalSubGroupCount={getTotalSubGroupCount(subGroup.id)}
                disableDrag
              />
              {expandedGroups.has(subGroup.id) && renderSubGroups(subGroup.id)}
            </div>
          ))}
        </div>
      </SortableContext>
    );
  };

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

  // 재귀적으로 그룹과 모든 하위 그룹의 질문 개수 합계 계산 (메모이제이션).
  // 재귀 본체는 모듈 최상위 countQuestionsInSubtree 가 갖는다.
  const getTotalQuestionCount = useCallback(
    (groupId: string): number => countQuestionsInSubtree(groupId, questionCountMap, getSubGroups),
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
      const orderSiblingGroups = groupsOrEmpty.filter(
        (g) => g.parentGroupId === parentGroupIdForNew,
      );
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
        // 실패는 null 로 돌려받아 원래 catch 의 early return 과 같은 자리에서 중단한다.
        const outcome = await runAsyncAction<{ id: string | undefined } | null>(
          async () => {
            await ensureSurvey();
            const createdGroup = await client.surveyBuilder.groups.create({
              surveyId: surveyId,
              name: groupName.trim(),
              ...(groupDescription.trim() ? { description: groupDescription.trim() } : {}),
              ...(parentGroupIdForNew ? { parentGroupId: parentGroupIdForNew } : {}),
              order: newGroupOrder,
            });
            return { id: createdGroup ? createdGroup.id : undefined };
          },
          {
            onError: (error) => {
              console.error('그룹 생성 실패:', error);
              toast.error('그룹 생성에 실패했습니다. 다시 시도해주세요.');
              return null;
            },
          },
        );
        if (!outcome) return;
        createdGroupId = outcome.id;
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
  };

  // 호출부는 두 곳(최상위 목록·renderSubGroups)뿐이고 둘 다 groupsOrEmpty 에서 파생한 목록의
  // 원소를 넘기므로, 여기서 같은 목록을 id 로 다시 뒤질 이유가 없다. 폼에 담지 않는 필드
  // (displayCondition 등)는 editingGroup 파생값 쪽에서 읽는다.
  const handleEditGroup = (group: QuestionGroup) => {
    setEditingGroupId(group.id);
    setGroupName(group.name);
    setGroupDescription(group.description || '');
    setParentGroupIdForEdit(group.parentGroupId);
    setHideNameForEdit(group.hideName ?? false);
    setNameDesignForEdit(group.nameDesign);
  };

  const handleGroupConditionUpdate = (conditionGroup: QuestionConditionGroup | undefined) => {
    if (editingGroup) {
      updateGroup(editingGroup.id, {
        ...(conditionGroup !== undefined ? { displayCondition: conditionGroup } : {}),
      });

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
    // editingGroup 이 null 이면 모달이 그려지지 않아 이 핸들러를 부를 화면이 없다 — 타입 좁히기다.
    // 이름은 다르다: 저장 버튼은 빈 이름에서 비활성이지만 이름 입력칸의 Enter 가 곧장 제출하므로
    // 여기가 실제 가드다.
    if (!editingGroup || !groupName.trim()) return;

    const oldParentGroupId = editingGroup.parentGroupId;
    const newParentGroupId = parentGroupIdForEdit;

    // 표시 조건은 폼 state 에 없다 — 모달 안 조건 편집기가 handleGroupConditionUpdate 로
    // store 에 바로 쓴다. editingGroup 이 그 store 의 파생값이라 여기서 읽으면 편집 결과가
    // 이미 들어 있고, 아래 payload 가 그대로 함께 실어 보낸다.
    const finalDisplayCondition = editingGroup.displayCondition;

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
        await runAsyncAction<void>(
          async () => {
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
                ...(finalDisplayCondition !== undefined
                  ? { displayCondition: finalDisplayCondition }
                  : {}),
              },
            });
          },
          {
            onError: (error) => {
              console.error('그룹 업데이트 저장 실패:', error);
            },
          },
        );
      }

      // 상위 그룹이 변경되면 해당 그룹을 펼침. store 를 직접 펼쳐야 유지된다 —
      // 로컬 state 만 바꾸던 때는 groups 갱신 이펙트가 곧바로 덮어써 접혔다.
      if (newParentGroupId) {
        updateGroup(newParentGroupId, { collapsed: false });
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
        await runAsyncAction<void>(
          async () => {
            await ensureSurvey();
            await client.surveyBuilder.groups.update({
              groupId: editingGroup.id,
              surveyId,
              data: {
                name: groupName.trim(),
                ...(groupDescription.trim() ? { description: groupDescription.trim() } : {}),
                hideName: hideNameForEdit,
                nameDesign: nameDesignForEdit ?? null,
                ...(finalDisplayCondition !== undefined
                  ? { displayCondition: finalDisplayCondition }
                  : {}),
              },
            });
          },
          {
            onError: (error) => {
              console.error('그룹 업데이트 저장 실패:', error);
            },
          },
        );
      }
    }

    // 이름 디자인 로컬 반영: 값이 있으면 set, 없으면 기본값으로 초기화(키 삭제).
    // Object.assign 기반 updateGroup 으로는 undefined 전달/키 삭제가 불가하므로 분기한다.
    if (nameDesignForEdit) {
      updateGroup(editingGroup.id, { nameDesign: nameDesignForEdit });
    } else {
      clearGroupNameDesign(editingGroup.id);
    }

    // editingGroupId 를 비우면 editingGroup 이 null 이 되어 모달이 닫힌다.
    setEditingGroupId(null);
    setGroupName('');
    setGroupDescription('');
    setParentGroupIdForEdit(undefined);
    setHideNameForEdit(false);
    setNameDesignForEdit(undefined);
    // 그룹 수정은 이미 updateQuestionGroup API로 저장됨
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
          await runAsyncAction<void>(
            async () => {
              await ensureSurvey();
              const uuidGroupIds = newGroupIds.filter((id) => isUUID(id));
              if (uuidGroupIds.length > 0) {
                await client.surveyBuilder.groups.reorder({ surveyId, groupIds: uuidGroupIds });
              }
            },
            {
              onError: (error) => {
                console.error('그룹 순서 저장 실패:', error);
              },
            },
          );
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

                      {/* 하위 그룹 렌더링 — 깊이 제한 없이 재귀 */}
                      {isExpanded && renderSubGroups(group.id)}
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
        onClose={() => {
          setEditingGroupId(null);
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
