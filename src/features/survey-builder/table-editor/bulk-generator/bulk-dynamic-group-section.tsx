import { Layers } from 'lucide-react';

import { Label } from '@/components/ui/label';
import type { DynamicRowGroupConfig } from '@/types/survey';

const GROUP_COLORS = [
  'bg-purple-500', 'bg-green-500', 'bg-yellow-500', 'bg-blue-500',
  'bg-pink-500', 'bg-orange-500', 'bg-teal-500', 'bg-red-500',
  'bg-indigo-500', 'bg-cyan-500', 'bg-lime-500', 'bg-rose-500',
  'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-sky-500',
  'bg-fuchsia-500', 'bg-stone-500',
];

interface BulkDynamicGroupSectionProps {
  dynamicRowGroups: DynamicRowGroupConfig[];
  selectedGroupId: string | undefined;
  onSelect: (groupId: string | undefined) => void;
}

export function BulkDynamicGroupSection({
  dynamicRowGroups,
  selectedGroupId,
  onSelect,
}: BulkDynamicGroupSectionProps) {
  if (dynamicRowGroups.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs font-medium">
        <Layers className="h-3.5 w-3.5 text-purple-600" />
        동적 행 그룹 (선택사항)
      </Label>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onSelect(undefined)}
          className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
            !selectedGroupId
              ? 'border-gray-400 bg-gray-100 font-medium'
              : 'border-gray-200 hover:bg-gray-50'
          }`}
        >
          없음
        </button>
        {dynamicRowGroups.map((group, idx) => (
          <button
            key={group.groupId}
            type="button"
            onClick={() => onSelect(group.groupId)}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
              selectedGroupId === group.groupId
                ? 'border-purple-400 bg-purple-50 font-medium'
                : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${GROUP_COLORS[idx % GROUP_COLORS.length]}`}
            />
            {group.label || group.groupId}
          </button>
        ))}
      </div>
    </div>
  );
}
