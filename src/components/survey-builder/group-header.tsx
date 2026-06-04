'use client';

import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { ChevronDown, ChevronRight, FolderOpen, GripVertical } from 'lucide-react';

import { useSurveyBuilderStore } from '@/stores/survey-store';
import { QuestionGroup } from '@/types/survey';

interface GroupHeaderProps {
  group: QuestionGroup;
  questionCount: number;
  subGroupCount?: number;
  className?: string;
  dragHandleProps?: {
    attributes: DraggableAttributes;
    listeners: SyntheticListenerMap | undefined;
    isDragging: boolean;
  };
}

export function GroupHeader({
  group,
  questionCount,
  subGroupCount = 0,
  className,
  dragHandleProps,
}: GroupHeaderProps) {
  const { toggleGroupCollapse } = useSurveyBuilderStore();

  const handleToggle = () => {
    toggleGroupCollapse(group.id);
  };

  return (
    <div
      className={`flex cursor-pointer items-center justify-between rounded-lg border-l-4 border-blue-500 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 transition-all hover:shadow-md ${className}`}
      onClick={handleToggle}
    >
      <div className="flex flex-1 items-center space-x-3">
        {dragHandleProps && (
          <div
            className={`rounded-md p-1 transition-all duration-200 ${
              dragHandleProps.isDragging
                ? 'cursor-grabbing bg-blue-200 text-blue-700'
                : 'cursor-grab text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing'
            }`}
            {...dragHandleProps.attributes}
            {...dragHandleProps.listeners}
            onClick={(e) => e.stopPropagation()}
            title="드래그하여 순서 변경"
          >
            <GripVertical className={`h-4 w-4 ${dragHandleProps.isDragging ? 'animate-pulse' : ''}`} />
          </div>
        )}
        <div className="text-blue-600">
          {group.collapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <ChevronDown className="h-5 w-5" />
          )}
        </div>
        <FolderOpen className="h-5 w-5 text-blue-600" />
        <div className="flex-1">
          <h3 className="text-base font-semibold text-gray-900">{group.name}</h3>
          {group.description && <p className="mt-0.5 text-xs text-gray-600">{group.description}</p>}
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <span className="rounded-full bg-white px-2 py-1 text-xs text-gray-500">
          {questionCount}개 질문{subGroupCount > 0 && ` • ${subGroupCount}개 하위그룹`}
        </span>
      </div>
    </div>
  );
}
