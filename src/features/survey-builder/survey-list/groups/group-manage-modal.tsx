'use client';

import { useState } from 'react';

import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLatestRef } from '@/hooks/use-latest-ref';
import { getErrorMessage } from '@/lib/get-error-message';
import { cn } from '@/lib/utils';
import { CreateSurveyGroupInput, SURVEY_GROUP_MAX_DEPTH } from '@/shared/contracts/workspace-io';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';
import { type SurveyGroupTreeNode, buildSurveyGroupTree } from '@/utils/survey-group-tree';

import { useCreateSurveyGroup, useReorderSurveyGroups } from '../../queries/use-survey-groups';
import { GroupDeleteDialog } from './group-delete-dialog';
import { GroupNameDialog, type GroupNameDialogTarget } from './group-name-dialog';
import { GroupRelocateDialog } from './group-relocate-dialog';
import { applyGroupSiblingOrder, planGroupSiblingReorder } from './group-reorder';

/** 최상위 형제 목록의 키 — 그룹 id(uuid)와 겹치지 않는다. */
const ROOT_KEY = 'root';
/** 맨 위 줄의 왼쪽 여백과 한 단계 내려갈 때마다 들여쓰는 폭(시안 G3). */
const ROOT_INSET = 4;
const DEPTH_INDENT = 24;

type GroupNode = SurveyGroupTreeNode<SurveyGroupListItem>;

/**
 * 저장을 기다리며 미리 그리는 형제 순서 — 부모마다 하나.
 *
 * `savedOn` 은 저장이 끝난 순간 보고 있던 목록의 모양이다. 그 뒤 **다시 읽은 목록이 오면 이 순서는
 * 옛것**이라 더 씌우지 않는다 — 서버의 순서가 답이다. 저장이 끝나자마자 걷으면 다시 읽은 목록이
 * 아직 안 와서 줄이 옛 자리로 튀었다가 돌아온다.
 */
interface PendingOrder {
  parentGroupId: string | null;
  orderedGroupIds: readonly string[];
  savedOn: string | null;
}

interface GroupManageModalProps {
  teamId: string;
  /** 그룹 목록 — 협업 그룹(타 팀 폴더)이 섞여 와도 창이 걸러 낸다. */
  groups: readonly SurveyGroupListItem[];
  onClose: () => void;
}

/**
 * 그룹 관리 창 (.pen FLOW 2-1 · 3단계 시안 G3) — 팀의 그룹 전체를 들여쓰기 트리로 보이고 구조를
 * 손보는 일을 한 창에서 한다.
 *
 * 모든 active 팀원이 함께 편집하는 팀 공용 폴더다. 여기서 하는 일 중 어느 것도 설문의 접근 권한을
 * 바꾸지 않는다 — 그래서 팀장 전용이 아니다. **내 팀 그룹만 선다**: 협업 그룹은 보이는 폴더일 뿐
 * 구조를 고칠 수 있는 폴더가 아니다.
 *
 * 줄의 ⋯ 메뉴는 이름 바꾸기 · 하위 그룹 만들기 · 옮기기 · 삭제다. 창과 판정을 다시 만들지 않고
 * 그룹 화면의 폴더 줄이 여는 것과 같은 창(이름 창 · 옮기기 창 · 삭제 확인)을 그대로 연다.
 * 최상위 그룹을 옮기는 입구는 여기뿐이다(폴더 줄은 하위 그룹만 그린다).
 *
 * **끌기는 같은 부모 안의 순서만 바꾼다.** 형제 목록마다 끌기 영역이 따로라 다른 부모의 줄 사이로는
 * 놓이지 않는다(다른 부모 밑으로 보내는 것은 순서가 아니라 옮기기다). 순서는 응답을 기다리지 않고
 * 미리 그린다 — 기다리면 놓는 순간 줄이 제자리로 튀었다가 다시 움직여 보인다.
 *
 * 창을 열면 전부 펼쳐져 있다(구조를 한눈에 보는 창이다). 접고 편 것은 창이 열려 있는 동안만 기억한다.
 */
export function GroupManageModal({ teamId, groups, onClose }: GroupManageModalProps) {
  const [pendingOrders, setPendingOrders] = useState<Record<string, PendingOrder>>({});
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [nameTarget, setNameTarget] = useState<GroupNameDialogTarget | null>(null);
  const [relocateTarget, setRelocateTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Pick<
    SurveyGroupListItem,
    'id' | 'name' | 'parentGroupId'
  > | null>(null);

  const createGroup = useCreateSurveyGroup();
  const reorderGroups = useReorderSurveyGroups();

  const ownGroups = groups.filter((group) => group.foreignTeamName === null);
  // 목록의 모양(누가 어느 부모 밑에 어떤 순서로 있는가) — 이름·건수가 바뀐 것은 순서와 무관하다.
  const structureKey = ownGroups.map((g) => `${g.id}>${g.parentGroupId ?? ''}`).join('|');
  const latestStructureKey = useLatestRef(structureKey);

  let shownGroups: readonly SurveyGroupListItem[] = ownGroups;
  for (const order of Object.values(pendingOrders)) {
    if (order.savedOn !== null && order.savedOn !== structureKey) continue;
    shownGroups = applyGroupSiblingOrder(shownGroups, order.parentGroupId, order.orderedGroupIds);
  }
  const tree = buildSurveyGroupTree(shownGroups);
  const namesById = new Map(ownGroups.map((group) => [group.id, group.name]));

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
    } catch (err) {
      setError(getErrorMessage(err, '그룹을 만들지 못했습니다.'));
    }
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const plan = planGroupSiblingReorder(shownGroups, String(active.id), String(over.id));
    if (!plan) return;

    const key = plan.parentGroupId ?? ROOT_KEY;
    const pending: PendingOrder = { ...plan, savedOn: null };
    setPendingOrders((prev) => ({ ...prev, [key]: pending }));
    setError(null);
    try {
      await reorderGroups.mutateAsync({ teamId, ...plan });
      // 그 사이 같은 부모에서 한 번 더 끌었으면 그쪽 순서가 주인이다.
      setPendingOrders((prev) =>
        prev[key] === pending
          ? { ...prev, [key]: { ...pending, savedOn: latestStructureKey.current } }
          : prev,
      );
    } catch (err) {
      // 실패하면 미리 그린 순서를 걷는다. 목록은 mutation 이 다시 읽어 지금 구조를 보인다 —
      // 거부의 대부분은 그 사이 다른 팀원이 구조를 바꾼 경우다.
      setPendingOrders((prev) => {
        if (prev[key] !== pending) return prev;
        const { [key]: _dropped, ...rest } = prev;
        return rest;
      });
      setError(getErrorMessage(err, '순서를 저장하지 못했습니다.'));
    }
  }

  function toggleBranch(groupId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(groupId)) next.add(groupId);
      return next;
    });
  }

  const rowActions: GroupRowActions = {
    onToggle: toggleBranch,
    onRename: (group) =>
      setNameTarget({ kind: 'rename', group: { id: group.id, name: group.name } }),
    onCreateSubgroup: (group) => {
      // 새 그룹이 설 자리가 보이도록 그 가지를 편다.
      setCollapsed((prev) => {
        if (!prev.has(group.id)) return prev;
        const next = new Set(prev);
        next.delete(group.id);
        return next;
      });
      setNameTarget({
        kind: 'create-subgroup',
        teamId,
        parent: { id: group.id, name: group.name },
      });
    },
    onRelocate: (group) => setRelocateTarget({ id: group.id, name: group.name }),
    onDelete: (group) =>
      setDeleteTarget({ id: group.id, name: group.name, parentGroupId: group.parentGroupId }),
  };

  return (
    <>
      <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent className="gap-0 rounded-2xl p-[22px] sm:max-w-[540px]">
          <DialogTitle className="text-[17px] font-semibold text-[#1C1C1E]">그룹 관리</DialogTitle>
          <DialogDescription className="mt-1 text-[12.5px] text-[#6E6E73]">
            팀원 누구나 고칠 수 있습니다 · 최대 {SURVEY_GROUP_MAX_DEPTH}단계
          </DialogDescription>

          {tree.length > 0 ? (
            <div className="-mx-2 mt-3 max-h-[min(56vh,460px)] overflow-y-auto px-2 py-0.5">
              <GroupSiblingList
                nodes={tree}
                label="설문 그룹"
                collapsed={collapsed}
                actions={rowActions}
                nameOf={(id) => namesById.get(String(id)) ?? ''}
                onDragEnd={handleDragEnd}
              />
            </div>
          ) : (
            <p className="mt-3 rounded-[10px] bg-[#F9FAFB] px-4 py-5 text-center text-[13px] leading-relaxed text-[#6E6E73]">
              아직 만든 그룹이 없습니다. 아래 「새 그룹」으로 첫 그룹을 만들어 보세요.
            </p>
          )}

          {creating && (
            <form
              onSubmit={handleCreate}
              className="mt-2.5 flex items-center gap-2 rounded-[10px] border border-[#E5E5EA] bg-[#F9FAFB] py-2 pr-2 pl-3 focus-within:border-[#2E4FCE]"
            >
              <Plus aria-hidden className="h-[15px] w-[15px] shrink-0 text-[#8E8E93]" />
              <input
                aria-label="새 그룹 이름"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  // 창까지 닫히지 않게 — Esc 한 번은 입력 줄만 접는다.
                  e.stopPropagation();
                  setCreating(false);
                  setNewName('');
                }}
                placeholder="새 그룹 이름 — 최상위에 만듭니다"
                maxLength={60}
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[#1C1C1E] outline-none placeholder:text-[#8E8E93]"
              />
              <button
                type="submit"
                disabled={createGroup.isPending}
                className="flex h-[30px] shrink-0 items-center gap-1 rounded-[7px] border border-[#E5E5EA] bg-white px-3 text-[12.5px] font-medium text-[#374151] hover:bg-[#F5F5F7] focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none disabled:opacity-50"
              >
                {createGroup.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                추가
              </button>
            </form>
          )}

          {error && (
            <p role="alert" className="mt-2.5 text-[12.5px] text-red-600">
              {error}
            </p>
          )}

          <p className="mt-3.5 text-[11.5px] leading-relaxed text-[#6E6E73]">
            그룹 이름은 같은 상위 그룹 안에서 겹칠 수 없습니다(최상위 그룹은 최상위끼리). 그룹은
            접근 권한이 아니라 정리용 묶음입니다.
          </p>

          <div className="mt-4 flex items-center justify-between gap-3">
            {creating ? (
              <span />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setError(null);
                }}
                className="-ml-1.5 flex h-[34px] items-center gap-1.5 rounded-[8px] px-1.5 text-[13.5px] font-semibold text-[#2E4FCE] hover:bg-[#EEF2FF] focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none"
              >
                <Plus aria-hidden className="h-4 w-4" />새 그룹
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-[36px] shrink-0 items-center rounded-[9px] bg-[#2E4FCE] px-4 text-[13.5px] font-semibold text-white hover:bg-[#2743AE] focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              닫기
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {nameTarget && <GroupNameDialog target={nameTarget} onClose={() => setNameTarget(null)} />}
      {relocateTarget && (
        <GroupRelocateDialog
          group={relocateTarget}
          groups={ownGroups}
          onClose={() => setRelocateTarget(null)}
        />
      )}
      {deleteTarget && (
        <GroupDeleteDialog
          group={deleteTarget}
          teamId={teamId}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

interface GroupRowActions {
  onToggle: (groupId: string) => void;
  onRename: (group: SurveyGroupListItem) => void;
  onCreateSubgroup: (group: SurveyGroupListItem) => void;
  onRelocate: (group: SurveyGroupListItem) => void;
  onDelete: (group: SurveyGroupListItem) => void;
}

interface GroupTreeProps {
  collapsed: ReadonlySet<string>;
  actions: GroupRowActions;
  /** 끌기 안내가 읽어 줄 그룹 이름. */
  nameOf: (id: UniqueIdentifier) => string;
  onDragEnd: (event: DragEndEvent) => void;
}

/**
 * 한 부모의 형제 줄들 — **끌기 영역이 형제 목록마다 따로다.**
 *
 * 줄은 자기가 속한 가장 가까운 영역 안에서만 끌리고 놓인다. 그래서 다른 부모의 줄은 놓을 자리로
 * 잡히지 않고, 자판으로 옮길 때도 같은 단계의 형제 사이만 오간다. 한 영역에 트리 전체를 넣고
 * 놓을 자리를 걸러 내는 방식은 자판 이동이 다른 부모의 줄 좌표를 따라가 버린다.
 */
function GroupSiblingList({
  nodes,
  label,
  ...tree
}: GroupTreeProps & {
  nodes: readonly GroupNode[];
  /** 맨 위 목록에만 붙는 이름 — 안쪽 목록은 자기를 여닫는 화살표가 이름을 대신한다. */
  label?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={tree.onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS },
        announcements: dragAnnouncements(tree.nameOf),
      }}
    >
      <SortableContext
        items={nodes.map((node) => node.group.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul aria-label={label} className="flex flex-col">
          {nodes.map((node) => (
            <GroupTreeRow key={node.group.id} node={node} {...tree} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

const DRAG_INSTRUCTIONS =
  '스페이스 키로 그룹을 집고, 위아래 화살표 키로 같은 단계 안에서 자리를 옮긴 뒤, 스페이스 키로 놓습니다. Esc 키로 취소합니다.';

function dragAnnouncements(nameOf: (id: UniqueIdentifier) => string): Announcements {
  return {
    onDragStart: ({ active }) => `「${nameOf(active.id)}」 그룹을 집었습니다.`,
    onDragOver: ({ active, over }) =>
      over ? `「${nameOf(active.id)}」 그룹이 「${nameOf(over.id)}」 자리에 있습니다.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `「${nameOf(active.id)}」 그룹을 「${nameOf(over.id)}」 자리에 놓았습니다.`
        : `「${nameOf(active.id)}」 그룹을 제자리에 두었습니다.`,
    onDragCancel: ({ active }) =>
      `옮기기를 취소했습니다. 「${nameOf(active.id)}」 그룹은 제자리에 있습니다.`,
  };
}

/**
 * 그룹 한 줄과 그 아래 가지 — 끌기 손잡이 · 펼침 화살표 · 이름 · 건수 · ⋯ 메뉴.
 *
 * 끌리는 것은 줄이 아니라 **가지 전체**다(하위 그룹이 부모를 따라 움직인다). 손잡이만 끌기를
 * 시작하므로 이름이나 화살표를 누르다 줄이 딸려 오지 않는다.
 */
function GroupTreeRow({ node, ...tree }: GroupTreeProps & { node: GroupNode }) {
  const { group, depth, children } = node;
  const { collapsed, actions } = tree;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id, attributes: { roleDescription: '순서를 바꿀 수 있는 그룹' } });

  const hasChildren = children.length > 0;
  const open = hasChildren && !collapsed.has(group.id);
  const FolderIcon = open ? FolderOpen : Folder;
  const atMaxDepth = depth >= SURVEY_GROUP_MAX_DEPTH;

  return (
    <li
      ref={setNodeRef}
      // 가지마다 높이가 달라 늘이고 줄이는 변환(scale)은 쓰지 않는다 — 자리만 옮긴다.
      style={{
        transform: CSS.Translate.toString(transform),
        transition: isDragging ? 'none' : transition,
      }}
      className={cn(
        'flex flex-col rounded-[9px]',
        isDragging && 'relative z-10 bg-white ring-1 ring-[#D9DBE1]',
      )}
    >
      <div
        style={{ paddingLeft: ROOT_INSET + (depth - 1) * DEPTH_INDENT }}
        className="flex h-10 items-center rounded-[9px] pr-1 transition-colors hover:bg-[#F5F5F7] has-[[data-popup-open]]:bg-[#F5F5F7]"
      >
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`${group.name} 순서 바꾸기`}
          className="flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-[#8E8E93] hover:text-[#374151] focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden className="h-4 w-4" />
        </button>

        {hasChildren ? (
          <button
            type="button"
            aria-label={`${group.name} ${open ? '접기' : '펼치기'}`}
            aria-expanded={open}
            onClick={() => actions.onToggle(group.id)}
            className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-[#6E6E73] hover:bg-[#E9EAEE] hover:text-[#1C1C1E] focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none"
          >
            {open ? (
              <ChevronDown aria-hidden className="h-4 w-4" />
            ) : (
              <ChevronRight aria-hidden className="h-4 w-4" />
            )}
          </button>
        ) : (
          // 화살표가 없는 줄도 같은 자리를 비워 폴더가 형제와 한 줄로 선다.
          <span aria-hidden className="w-6 shrink-0" />
        )}

        <FolderIcon aria-hidden className="ml-1 h-4 w-4 shrink-0 text-[#2743AE]" />
        <span
          title={group.name}
          className={cn(
            'ml-2 min-w-0 flex-1 truncate text-[14px] text-[#1C1C1E]',
            depth === 1 && 'font-semibold',
          )}
        >
          {group.name}
        </span>
        <span className="shrink-0 pr-1.5 pl-3 text-[12.5px] text-[#6E6E73] tabular-nums">
          설문 {group.surveyCount}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`${group.name} 더보기`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#6E6E73] hover:bg-[#E9EAEE] hover:text-[#1C1C1E] focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none data-[popup-open]:bg-[#E9EAEE] data-[popup-open]:text-[#1C1C1E]"
              />
            }
          >
            <Ellipsis aria-hidden className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-[168px]">
            <DropdownMenuItem onClick={() => actions.onRename(group)}>
              <Pencil className="h-3.5 w-3.5" />
              이름 바꾸기
            </DropdownMenuItem>
            {/* 3단계 줄에서는 꺼져 있다 — 만들 수 없는 것을 눌러 보고 오류를 만나지 않게. */}
            <DropdownMenuItem disabled={atMaxDepth} onClick={() => actions.onCreateSubgroup(group)}>
              <FolderPlus className="h-3.5 w-3.5" />
              하위 그룹 만들기
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onRelocate(group)}>
              <FolderInput className="h-3.5 w-3.5" />
              옮기기
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* 그룹 화면 폴더 줄의 「삭제」와 같은 얼굴이다. */}
            <DropdownMenuItem
              className="text-red-600 data-[highlighted]:text-red-600"
              onClick={() => actions.onDelete(group)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open && <GroupSiblingList nodes={children} {...tree} />}
    </li>
  );
}
