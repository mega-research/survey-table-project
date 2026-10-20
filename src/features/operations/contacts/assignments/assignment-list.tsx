'use client';

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
import { GripVertical } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatLocalMonthDayTime } from '@/lib/date-formatters';
import { getErrorMessage } from '@/lib/get-error-message';
import type {
  ContactAssignmentListResult,
  ContactAssignmentListRow,
  ContactAssignmentStats,
} from '@/shared/contracts/contacts-io';
import { client } from '@/shared/lib/rpc';

import { assignmentEditHref, unassignedContactsHref } from './assignment-hrefs';

interface Props {
  surveyId: string;
  data: ContactAssignmentListResult;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

function completionRate(stats: ContactAssignmentStats): number {
  return stats.assigned === 0 ? 0 : Math.round((stats.completed / stats.assigned) * 100);
}

/**
 * 컨택원 관리 목록 (시안 B) — 컨택원마다 배정·완료·진행 중·미접속·완료율·마지막 적용.
 * 맨 아래 「(배정 없음)」 줄은 조사 대상 목록의 같은 필터로 이어진다.
 * 끌어서 순서를 바꾸고(필터 선택지·진척 보고 줄 순서), 이름 바꾸기·지우기를 한다.
 */
export function AssignmentList({ surveyId, data }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(data.rows);
  const [renaming, setRenaming] = useState<ContactAssignmentListRow | null>(null);
  const [removing, setRemoving] = useState<ContactAssignmentListRow | null>(null);
  const [isPending, startTransition] = useTransition();

  // router.refresh 로 내려온 새 목록에 맞춘다 — 렌더 중 조정 패턴.
  const [prevData, setPrevData] = useState(data);
  if (prevData !== data) {
    setPrevData(data);
    setRows(data.rows);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.id === active.id);
    const to = rows.findIndex((r) => r.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(rows, from, to);
    setRows(next);
    startTransition(async () => {
      try {
        await client.contacts.assignments.reorder({ surveyId, ids: next.map((r) => r.id) });
        router.refresh();
      } catch (err) {
        setRows(data.rows);
        toast.error(getErrorMessage(err, '순서를 바꾸지 못했습니다.'));
      }
    });
  };

  const assignedTotal = data.total - data.unassigned.assigned;

  return (
    <div className="rounded-lg border bg-white p-5">
      <p className="mb-3 text-sm text-slate-600">
        한 조사 대상은 컨택원 하나에만 배정됩니다. 다른 컨택원에 넣으면 이전 배정에서 자동으로
        빠집니다.
      </p>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="w-8 border-b px-2 py-2" aria-label="순서" />
              <th className="border-b px-3 py-2 text-left">컨택원 이름</th>
              <th className="border-b px-3 py-2 text-right">배정</th>
              <th className="border-b px-3 py-2 text-right">완료</th>
              <th className="border-b px-3 py-2 text-right">진행 중</th>
              <th className="border-b px-3 py-2 text-right">미접속</th>
              <th className="border-b px-3 py-2 text-left">완료율</th>
              <th className="border-b px-3 py-2 text-left">마지막 적용</th>
              <th className="border-b px-3 py-2" aria-label="작업" />
            </tr>
          </thead>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                      아직 컨택원이 없습니다. 「+ 컨택원 추가」로 만들어 보세요.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <SortableRow
                    key={r.id}
                    row={r}
                    surveyId={surveyId}
                    disabled={isPending}
                    onRename={() => setRenaming(r)}
                    onRemove={() => setRemoving(r)}
                  />
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
          <tfoot>
            <tr className="border-t bg-slate-50 text-slate-500">
              <td />
              <td className="px-3 py-2">(배정 없음)</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(data.unassigned.assigned)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(data.unassigned.completed)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(data.unassigned.inProgress)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt(data.unassigned.notStarted)}</td>
              <td colSpan={3} className="px-3 py-2 text-right">
                <Link
                  href={unassignedContactsHref(surveyId)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  조사 대상 목록에서 보기 →
                </Link>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          전체 {fmt(data.total)}명 · 배정 {fmt(assignedTotal)}명 · 배정 없음{' '}
          {fmt(data.unassigned.assigned)}명
        </span>
        <span>순서는 끌어서 바꿉니다 — 필터·진척 보고의 표시 순서</span>
      </div>

      <RenameDialog
        surveyId={surveyId}
        target={renaming}
        onClose={() => setRenaming(null)}
        onDone={() => router.refresh()}
      />
      <RemoveDialog
        surveyId={surveyId}
        target={removing}
        onClose={() => setRemoving(null)}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

function SortableRow({
  row,
  surveyId,
  disabled,
  onRename,
  onRemove,
}: {
  row: ContactAssignmentListRow;
  surveyId: string;
  disabled: boolean;
  onRename: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled,
  });
  const rate = completionRate(row.stats);
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-t ${isDragging ? 'relative z-10 bg-blue-50' : 'bg-white'}`}
    >
      <td className="px-2 py-2 text-slate-400">
        <button
          type="button"
          className="cursor-grab touch-none p-1 hover:text-slate-700"
          aria-label={`${row.name} 순서 옮기기`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      </td>
      <td className="px-3 py-2 font-medium text-slate-900">{row.name}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(row.stats.assigned)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(row.stats.completed)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(row.stats.inProgress)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(row.stats.notStarted)}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${rate}%` }} />
          </div>
          <span className="text-xs tabular-nums text-slate-600">{rate}%</span>
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-slate-500" suppressHydrationWarning>
        {row.lastAppliedAt ? formatLocalMonthDayTime(row.lastAppliedAt) : '—'}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={onRename}
          className="mr-3 text-xs text-slate-500 hover:text-slate-800"
        >
          이름 바꾸기
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="mr-3 text-xs text-red-500 hover:text-red-700"
        >
          삭제
        </button>
        <Link href={assignmentEditHref(surveyId, row.id)} className="text-xs text-blue-600 hover:underline">
          수정
        </Link>
      </td>
    </tr>
  );
}

function RenameDialog({
  surveyId,
  target,
  onClose,
  onDone,
}: {
  surveyId: string;
  target: ContactAssignmentListRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [isPending, startTransition] = useTransition();
  const [prevTarget, setPrevTarget] = useState(target);
  if (prevTarget !== target) {
    setPrevTarget(target);
    setName(target?.name ?? '');
  }

  const submit = () => {
    if (!target || name.trim().length === 0) return;
    startTransition(async () => {
      try {
        await client.contacts.assignments.rename({ surveyId, id: target.id, name });
        toast.success('이름을 바꿨습니다.');
        onClose();
        onDone();
      } catch (err) {
        toast.error(getErrorMessage(err, '이름을 바꾸지 못했습니다.'));
      }
    });
  };

  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>컨택원 이름 바꾸기</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input aria-label="컨택원 이름" value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={isPending || name.trim().length === 0}>
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({
  surveyId,
  target,
  onClose,
  onDone,
}: {
  surveyId: string;
  target: ContactAssignmentListRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const submit = () => {
    if (!target) return;
    startTransition(async () => {
      try {
        const { unassigned } = await client.contacts.assignments.remove({
          surveyId,
          id: target.id,
        });
        toast.success(
          unassigned > 0
            ? `컨택원을 지웠습니다. ${fmt(unassigned)}명이 배정 없음이 됐습니다.`
            : '컨택원을 지웠습니다.',
        );
        onClose();
        onDone();
      } catch (err) {
        toast.error(getErrorMessage(err, '컨택원을 지우지 못했습니다.'));
      }
    });
  };
  return (
    <AlertDialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>컨택원 {target?.name}을(를) 지웁니다</AlertDialogTitle>
          <AlertDialogDescription>
            {target && target.stats.assigned > 0
              ? `배정된 ${fmt(target.stats.assigned)}명이 배정 없음이 됩니다. 되돌릴 수 없습니다.`
              : '배정된 대상이 없습니다. 되돌릴 수 없습니다.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={submit}
            className="bg-red-600 hover:bg-red-700"
          >
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
