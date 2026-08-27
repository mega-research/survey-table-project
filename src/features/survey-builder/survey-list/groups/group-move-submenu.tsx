'use client';

import { Check, Folder, FolderInput, FolderMinus } from 'lucide-react';

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

interface GroupMoveSubmenuProps {
  groups: readonly SurveyGroupListItem[];
  /** 이 설문이 지금 속한 그룹 — 하이라이트 + 체크. null 이면 미분류다. */
  currentGroupId: string | null;
  /** 그 설문의 편집 권한 근사. 서버가 다시 판정하지만 없으면 항목 자체를 잠근다. */
  disabled: boolean;
  onMove: (groupId: string | null) => void;
}

/**
 * 설문 카드 케밥의 「그룹 이동」 서브메뉴 (.pen FLOW 2-4).
 *
 * 그룹 간 이동은 **이 단건 동선만** 쓴다 — 「설문 담기」는 미분류 전용이라 다른 그룹에서
 * 빼오는 암묵 이동이 없다. 현재 그룹은 체크로 표시하되 비활성으로 두지 않는다: 같은 그룹을
 * 다시 고르는 것은 아무 일도 아니고, 비활성이면 "어디에 있는지" 를 읽기 어려워진다.
 */
export function GroupMoveSubmenu({
  groups,
  currentGroupId,
  disabled,
  onMove,
}: GroupMoveSubmenuProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <FolderInput className="h-3.5 w-3.5" />
        그룹 이동
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-[238px]">
        {groups.length === 0 ? (
          <p className="px-2 py-2 text-[12px] text-[#9CA3AF]">아직 만든 그룹이 없습니다.</p>
        ) : (
          groups.map((group) => {
            const isCurrent = group.id === currentGroupId;
            return (
              <DropdownMenuItem
                key={group.id}
                onSelect={() => onMove(group.id)}
                className={cn(isCurrent && 'bg-[#EEF2FF] text-[#2743AE] focus:bg-[#EEF2FF]')}
              >
                <Folder className={cn('h-3.5 w-3.5', isCurrent && 'text-[#2743AE]')} />
                <span className={cn('truncate', isCurrent && 'font-semibold')}>{group.name}</span>
                {isCurrent && <Check className="ml-auto h-3.5 w-3.5 text-[#2743AE]" />}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={currentGroupId === null}
          onSelect={() => onMove(null)}
          className="text-[#6E6E73]"
        >
          <FolderMinus className="h-3.5 w-3.5" />
          미분류로 이동 (그룹에서 빼기)
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
