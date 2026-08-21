'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  GripVertical,
  MoreVertical,
  Plus,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { QuestionGroup } from '@/types/survey';

export interface SortableGroupItemProps {
  group: QuestionGroup;
  questionCount: number;
  subGroups: QuestionGroup[];
  isExpanded: boolean;
  onEdit: (group: QuestionGroup) => void;
  onDelete: (groupId: string) => void;
  onToggleExpand: (groupId: string) => void;
  onAddSubGroup: (parentGroupId: string) => void;
  totalSubGroupCount?: number;
  disableDrag?: boolean;
}

export function SortableGroupItem({
  group,
  questionCount,
  subGroups,
  isExpanded,
  onEdit,
  onDelete,
  onToggleExpand,
  onAddSubGroup,
  totalSubGroupCount = 0,
  disableDrag = false,
}: SortableGroupItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
    disabled: disableDrag,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const hasSubGroups = subGroups.length > 0;

  return (
    <div ref={setNodeRef} style={style} className={`${isDragging ? 'z-50 shadow-lg' : ''}`}>
      <div
        data-group-id={group.id}
        className="relative flex items-center justify-between rounded-lg bg-gray-50 p-2 transition-all hover:bg-gray-100"
      >
        <div className="flex min-w-0 flex-1 items-center space-x-2">
          {hasSubGroups && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(group.id);
              }}
              className="text-gray-500 hover:text-gray-700"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          )}
          {!hasSubGroups && <div className="w-4" />}
          <div
            className={disableDrag
              ? 'text-gray-200'
              : 'cursor-grab text-gray-400 hover:text-gray-600 active:cursor-grabbing'
            }
            {...(disableDrag ? {} : { ...attributes, ...listeners })}
            title={disableDrag ? '질문 목록에서 드래그하여 순서 변경' : undefined}
          >
            <GripVertical className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{group.name}</p>
            <p className="text-xs text-gray-500">
              {questionCount}개 질문
              {totalSubGroupCount > 0 && ` • ${totalSubGroupCount}개 하위그룹`}
            </p>
          </div>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-1" align="end" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col">
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddSubGroup(group.id);
                }}
              >
                <Plus className="h-4 w-4" />
                하위 그룹 추가
              </button>
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(group);
                }}
              >
                <Edit3 className="h-4 w-4" />
                수정
              </button>
              <button
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(group.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
                삭제
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
