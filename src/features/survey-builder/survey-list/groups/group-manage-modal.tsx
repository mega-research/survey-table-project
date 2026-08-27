'use client';

import { useState } from 'react';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Folder, GripVertical, ListPlus, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/get-error-message';
import { cn } from '@/lib/utils';
import { CreateSurveyGroupInput, RenameSurveyGroupInput } from '@/shared/contracts/workspace-io';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import {
  useCreateSurveyGroup,
  useRenameSurveyGroup,
  useReorderSurveyGroups,
} from '../../queries/use-survey-groups';
import { GroupCollectModal } from './group-collect-modal';
import { GroupDeleteDialog } from './group-delete-dialog';

interface GroupManageModalProps {
  teamId: string;
  groups: readonly SurveyGroupListItem[];
  onClose: () => void;
}

/**
 * 그룹 관리 모달 (.pen FLOW 2-1) — 생성 · 이름 변경 · 정렬 · 삭제 + 「설문 담기」 진입.
 *
 * 모든 active 팀원이 함께 편집하는 팀 공용 폴더다. 여기서 하는 일 중 어느 것도 설문의
 * 접근 권한을 바꾸지 않는다 — 그래서 팀장 전용이 아니다.
 *
 * 정렬은 낙관적으로 미리 그린다. 서버 왕복을 기다리면 드래그를 놓는 순간 항목이 제자리로
 * 튀었다가 다시 움직여 보인다.
 */
export function GroupManageModal({ teamId, groups, onClose }: GroupManageModalProps) {
  const [order, setOrder] = useState<readonly string[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [collectTarget, setCollectTarget] = useState<SurveyGroupListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SurveyGroupListItem | null>(null);

  const createGroup = useCreateSurveyGroup();
  const renameGroup = useRenameSurveyGroup();
  const reorderGroups = useReorderSurveyGroups();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // 낙관적 순서가 있으면 그것으로 그린다. 서버 목록이 갱신되면 id 집합이 달라지므로
  // (생성·삭제) 그때는 낙관적 순서를 버리고 서버 순서로 돌아간다.
  const ordered = resolveOrder(groups, order);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = CreateSurveyGroupInput.safeParse({ teamId, name: newName });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
      return;
    }
    try {
      await createGroup.mutateAsync(parsed.data);
      setNewName('');
      setOrder(null);
    } catch (err) {
      setError(getErrorMessage(err, '그룹을 만들지 못했습니다.'));
    }
  }

  async function handleRename(groupId: string) {
    setError(null);
    const parsed = RenameSurveyGroupInput.safeParse({ groupId, name: editingName });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력을 다시 확인해 주세요.');
      return;
    }
    try {
      await renameGroup.mutateAsync(parsed.data);
      setEditingId(null);
    } catch (err) {
      setError(getErrorMessage(err, '그룹 이름을 바꾸지 못했습니다.'));
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ordered.findIndex((g) => g.id === active.id);
    const to = ordered.findIndex((g) => g.id === over.id);
    if (from < 0 || to < 0) return;

    const next = arrayMove([...ordered], from, to).map((g) => g.id);
    setOrder(next);
    setError(null);
    try {
      await reorderGroups.mutateAsync({ teamId, orderedGroupIds: next });
    } catch (err) {
      setOrder(null); // 실패하면 서버 순서로 되돌린다.
      setError(getErrorMessage(err, '순서를 저장하지 못했습니다.'));
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent className="max-w-[480px] gap-0 rounded-2xl p-[22px]">
          <DialogTitle className="text-[17px] font-semibold text-[#1C1C1E]">그룹 관리</DialogTitle>
          <p className="mt-[3px] text-[12.5px] text-[#6E6E73]">
            모든 active 팀원이 함께 편집하는 팀 공용 폴더입니다.
          </p>

          <div className="mt-3.5 flex flex-col gap-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={ordered.map((g) => g.id)}
                strategy={verticalListSortingStrategy}
              >
                {ordered.map((group) => (
                  <SortableGroupRow
                    key={group.id}
                    group={group}
                    isEditing={editingId === group.id}
                    editingName={editingName}
                    isSaving={renameGroup.isPending}
                    onEditingNameChange={setEditingName}
                    onStartEdit={() => {
                      setEditingId(group.id);
                      setEditingName(group.name);
                      setError(null);
                    }}
                    onCancelEdit={() => setEditingId(null)}
                    onSubmitEdit={() => handleRename(group.id)}
                    onCollect={() => setCollectTarget(group)}
                    onDelete={() => setDeleteTarget(group)}
                  />
                ))}
              </SortableContext>
            </DndContext>

            {ordered.length === 0 && (
              <p className="py-3 text-center text-[12.5px] text-[#9CA3AF]">
                아직 만든 그룹이 없습니다.
              </p>
            )}

            <form
              onSubmit={handleCreate}
              className="flex items-center gap-2 rounded-[10px] border border-[#E5E5EA] bg-[#F9FAFB] px-3 py-2.5"
            >
              <Plus className="h-[15px] w-[15px] shrink-0 text-[#9CA3AF]" />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="새 그룹 이름"
                maxLength={60}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1C1C1E] outline-none placeholder:text-[#9CA3AF]"
              />
              <button
                type="submit"
                disabled={createGroup.isPending}
                className="flex h-[30px] shrink-0 items-center gap-1 rounded-[7px] border border-[#E5E5EA] bg-white px-3 text-[12.5px] font-medium text-[#374151] hover:bg-[#F5F5F7] disabled:opacity-50"
              >
                {createGroup.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                추가
              </button>
            </form>
          </div>

          {error && <p className="mt-2.5 text-[12.5px] text-red-600">{error}</p>}

          <p className="mt-3.5 text-[11.5px] leading-relaxed text-[#9CA3AF]">
            그룹 이름은 팀 안에서 중복될 수 없습니다. 그룹은 접근 권한이 아니라 정리용 묶음입니다.
          </p>
        </DialogContent>
      </Dialog>

      {collectTarget && (
        <GroupCollectModal
          teamId={teamId}
          group={collectTarget}
          onClose={() => setCollectTarget(null)}
        />
      )}
      {deleteTarget && (
        <GroupDeleteDialog group={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </>
  );
}

/**
 * 낙관적 순서를 서버 목록에 씌운다.
 *
 * 낙관적 배열에 없는 그룹이 서버에 생겼거나(다른 팀원이 만듦) 사라졌으면 그 배열은 이미
 * 옛것이다 — 억지로 씌우면 새 그룹이 화면에서 사라진다. 그때는 서버 순서를 그대로 쓴다.
 */
function resolveOrder(
  groups: readonly SurveyGroupListItem[],
  order: readonly string[] | null,
): readonly SurveyGroupListItem[] {
  if (!order || order.length !== groups.length) return groups;
  const byId = new Map(groups.map((g) => [g.id, g]));
  const mapped = order.map((id) => byId.get(id));
  return mapped.every((g): g is SurveyGroupListItem => g !== undefined) ? mapped : groups;
}

interface SortableGroupRowProps {
  group: SurveyGroupListItem;
  isEditing: boolean;
  editingName: string;
  isSaving: boolean;
  onEditingNameChange: (next: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  onCollect: () => void;
  onDelete: () => void;
}

function SortableGroupRow({
  group,
  isEditing,
  editingName,
  isSaving,
  onEditingNameChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onCollect,
  onDelete,
}: SortableGroupRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? 'none' : transition,
      }}
      className={cn(
        'flex items-center gap-2.5 rounded-[10px] border bg-white px-3 py-2.5',
        isEditing ? 'border-[1.5px] border-[#2E4FCE]' : 'border-[#E5E5EA]',
        isDragging && 'opacity-80',
      )}
    >
      <button
        type="button"
        aria-label="순서 변경"
        className="shrink-0 cursor-grab text-[#9CA3AF]"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {isEditing ? (
        <>
          <input
            value={editingName}
            onChange={(e) => onEditingNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmitEdit();
              if (e.key === 'Escape') onCancelEdit();
            }}
            maxLength={60}
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-[#E5E5EA] px-2.5 py-1.5 text-[13px] text-[#1C1C1E] outline-none focus:border-[#2E4FCE]"
          />
          <button
            type="button"
            onClick={onSubmitEdit}
            disabled={isSaving}
            className="flex h-[28px] shrink-0 items-center gap-1 rounded-[7px] bg-[#2E4FCE] px-3 text-[12.5px] font-semibold text-white hover:bg-[#2743AE] disabled:opacity-50"
          >
            {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
            저장
          </button>
        </>
      ) : (
        <>
          <Folder className="h-[15px] w-[15px] shrink-0 text-[#2743AE]" />
          <span className="min-w-0 truncate text-[13.5px] font-semibold text-[#1C1C1E]">
            {group.name}
          </span>
          <span className="shrink-0 text-[11.5px] text-[#6E6E73]">설문 {group.surveyCount}개</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onCollect}
            className="flex h-[28px] shrink-0 items-center gap-1.5 rounded-[7px] border border-[#E5E5EA] bg-white px-2.5 text-[12px] font-medium text-[#374151] hover:bg-[#F5F5F7]"
          >
            <ListPlus className="h-3.5 w-3.5" />
            설문 담기
          </button>
          <button
            type="button"
            aria-label={`${group.name} 이름 변경`}
            onClick={onStartEdit}
            className="shrink-0 text-[#374151] hover:text-[#1C1C1E]"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`${group.name} 삭제`}
            onClick={onDelete}
            className="shrink-0 text-[#EF4444] hover:text-[#DC2626]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
