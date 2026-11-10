'use client';

import { Check, Folder, FolderInput, FolderMinus } from 'lucide-react';

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { listGroupMoveOptions } from './group-move-options';

interface GroupMoveSubmenuProps {
  /** 그 팀의 그룹 전부(어느 단계든) — 평평한 목록 그대로 넘긴다. 트리는 여기서 묶는다. */
  groups: readonly SurveyGroupListItem[];
  /** 이 설문이 지금 속한 그룹 — 하이라이트 + 체크. null 이면 미분류다. */
  currentGroupId: string | null;
  /** 그 설문의 편집 권한 근사. 서버가 다시 판정하지만 없으면 항목 자체를 잠근다. */
  disabled: boolean;
  onMove: (groupId: string | null) => void;
}

/** 한 단 깊어질 때마다 들이는 폭(px) — 폴더 아이콘(14px)이 윗단 이름의 첫 글자 아래에 온다. */
const INDENT_STEP_PX = 16;
/** 메뉴 항목의 기본 왼쪽 안여백(px-2). 들여쓰기는 여기에 더한다. */
const ITEM_PADDING_LEFT_PX = 8;

/**
 * 설문 카드 케밥의 「그룹 이동」 서브메뉴 (.pen FLOW 2-4 · 3단계 중첩 티켓 04).
 *
 * 그룹 간 이동은 **이 단건 동선만** 쓴다 — 「설문 담기」는 미분류 전용이라 다른 그룹에서
 * 빼오는 암묵 이동이 없다. 현재 그룹은 체크로 표시하되 비활성으로 두지 않는다: 같은 그룹을
 * 다시 고르는 것은 아무 일도 아니고, 비활성이면 "어디에 있는지" 를 읽기 어려워진다.
 *
 * **그룹은 들여쓰기 트리다.** 설문은 1·2·3단계 어느 그룹에든 담기므로 모든 줄이 고를 수 있는
 * 자리이고, 펼침·접힘은 두지 않는다 — 메뉴는 한 번 훑고 고르는 곳이라 접어 두면 누를 일만
 * 는다. 하위 그룹을 만들지 않은 팀은 모든 줄이 1단이라 전과 같은 한 단 목록이다.
 *
 * 하위 그룹 줄의 이름(읽어 주는 이름)은 위쪽 경로를 포함한다 — 「2025」가 사람마다 하나씩
 * 있어도 화면을 보지 않고 가를 수 있다. 보이는 글자는 그 그룹의 이름뿐이다.
 */
export function GroupMoveSubmenu({
  groups,
  currentGroupId,
  disabled,
  onMove,
}: GroupMoveSubmenuProps) {
  const options = listGroupMoveOptions(groups);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <FolderInput className="h-3.5 w-3.5" />
        그룹 이동
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-[238px]">
        {/* 패널이 열리면 트리거 문구는 부모 메뉴에 남는다 — 라벨이 없으면 그룹 이름이
            설문 제목처럼 읽힌다(.pen FLOW 2-4 의 「서브메뉴 라벨 행」). */}
        {/* 공식 DropdownMenuLabel 은 Base UI GroupLabel 이라 Group 안에 있어야 한다(밖이면 런타임 오류). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] font-semibold text-[#9CA3AF]">
            그룹 이동
          </DropdownMenuLabel>
          {options.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-[#9CA3AF]">아직 만든 그룹이 없습니다.</p>
          ) : (
            // 그룹 줄만 따로 스크롤한다 — 가지가 길어져도 아래 「미분류로 이동」이 밀려 내려가지 않는다.
            <div className="max-h-[min(320px,50vh)] overflow-y-auto">
              {options.map(({ group, depth, pathLabel }) => {
                const isCurrent = group.id === currentGroupId;
                const isNested = depth > 1;
                return (
                  <DropdownMenuItem
                    key={group.id}
                    data-depth={depth}
                    aria-label={isNested ? pathLabel : undefined}
                    aria-current={isCurrent ? 'true' : undefined}
                    title={pathLabel}
                    onClick={() => onMove(group.id)}
                    style={
                      isNested
                        ? { paddingLeft: ITEM_PADDING_LEFT_PX + (depth - 1) * INDENT_STEP_PX }
                        : undefined
                    }
                    className={cn(
                      isCurrent && 'bg-[#EEF2FF] text-[#2743AE] data-[highlighted]:bg-[#EEF2FF]',
                    )}
                  >
                    <Folder className={cn('h-3.5 w-3.5', isCurrent && 'text-[#2743AE]')} />
                    <span className={cn('truncate', isCurrent && 'font-semibold')}>
                      {group.name}
                    </span>
                    {isCurrent && <Check className="ml-auto h-3.5 w-3.5 text-[#2743AE]" />}
                  </DropdownMenuItem>
                );
              })}
            </div>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={currentGroupId === null}
          onClick={() => onMove(null)}
          className="text-[#6E6E73]"
        >
          <FolderMinus className="h-3.5 w-3.5" />
          미분류로 이동 (그룹에서 빼기)
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
