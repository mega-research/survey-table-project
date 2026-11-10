'use client';

import { useState } from 'react';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';
import { surveyGroupListQueryOptions } from '@/shared/lib/survey-group-queries';
import {
  type SurveyGroupTreeNode,
  buildSurveyGroupTree,
  findSurveyGroupPath,
  listSurveyGroupPathLabels,
} from '@/utils/survey-group-tree';

/** 맨 위 줄의 왼쪽 여백 — 화살표 자리(20px)를 더하면 폴더가 종전과 같은 24px 에 선다. */
const ROOT_INSET = 4;
/** 한 단계 내려갈 때마다 들여쓰는 폭. 3단계에서도 이름이 일곱 자쯤 남는다(사이드바 232px). */
const DEPTH_INDENT = 14;

type GroupNode = SurveyGroupTreeNode<SurveyGroupListItem>;

/**
 * 사이드바 「설문 목록」 하위의 그룹 트리 (.pen FLOW 1-4·2 배경, 3단계 시안 G1·G2).
 *
 * 그룹 화면으로 들어가는 입구다 — 그룹은 목록의 필터가 아니라 `?group=<id>` 라는 주소라서,
 * 팀원은 본문을 거치지 않고 여기서 다른 가지로 바로 건너간다.
 *
 * **내 팀 그룹은 트리다.** 지금 들어가 있는 그룹과 그 위 그룹들은 펼쳐져 있고 나머지 가지는
 * 접힌 채 화살표로 연다. 켜지는 줄은 지금 그룹 하나다 — 위쪽 그룹은 펼쳐져 있는 것으로 위치를
 * 말한다. 트리는 그룹 목록 쿼리 하나에서 파생한다(사이드바용 조회가 따로 없다): 그룹 구조를
 * 바꾼 화면이 그 쿼리를 무효화하면 여기도 새 구조를 그린다.
 *
 * **펼침은 화면 상태다**(저장하지 않는다). 사용자가 누른 화살표가 자동 펼침을 덮되, 다른
 * 그룹으로 옮겨 가면 그 가지 위의 「접어 둠」은 걷는다 — 접어 둔 가지 안으로 들어갔는데
 * 사이드바가 어디인지 말해 주지 않으면 트리를 둔 이유가 없다. 손으로 펼친 다른 가지는 남는다.
 *
 * **협업 그룹**(`foreignTeamName` 이 있는 행)은 타 팀 폴더다 — 내가 참여자로 초대됐거나 내
 * 팀원이 초대된 설문이 그 안에 있어서 보인다. 트리 아래에 평평하게 두고 소유 팀을 함께 적는다:
 * 서버가 타 팀의 위쪽 그룹을 알려 주지 않아 매달 자리가 없고, 소유 팀을 밝히지 않으면 이름을
 * 고칠 수 없는 폴더가 내 것처럼 보인다(설문 카드가 「… 소유」를 적는 것과 같은 이유).
 *
 * .pen 은 활성 그룹 아래 하위 설문 2건 + 「… N개 더」까지 펼치고 미분류 설문도 최상위 항목으로
 * 늘어놓는다. 그 두 가지는 바로 옆 본문 목록과 같은 내용을 되풀이하는 것이라 넣지 않았다 —
 * 사이드바가 설문 목록 쿼리까지 들고 있게 되어 묶음 경계도 함께 넘는다.
 *
 * 팀 범위가 아니면(시스템 전체 보기·팀 미배치) 아무것도 그리지 않는다. 그룹은 팀 소유물이고
 * 시스템 전체 보기는 조회 범위일 뿐이라 그룹 개념 자체가 없다(.pen 6-2).
 */
export function SidebarGroupTree({ teamId }: { teamId: string | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data } = useQuery(surveyGroupListQueryOptions(teamId));
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [seenPathKey, setSeenPathKey] = useState('');

  const groups = data ?? [];
  const ownGroups = groups.filter((group) => group.foreignTeamName === null);
  const collabGroups = groups.filter((group) => group.foreignTeamName !== null);

  const onListPage = pathname === '/surveys';
  const activeGroupId = onListPage ? searchParams.get('group') : null;
  // 뿌리부터 지금 그룹까지 — 이 줄들이 자동으로 펼쳐진다. 협업 그룹은 내 팀 목록에 없어 빈 경로다.
  const activePathIds = activeGroupId
    ? findSurveyGroupPath(ownGroups, activeGroupId).map((group) => group.id)
    : [];

  // 들어가 있는 가지가 바뀌면(화면 이동 · 구조 변경) 그 가지 위의 손댄 흔적을 걷는다.
  const pathKey = activePathIds.join('/');
  if (pathKey !== seenPathKey) {
    setSeenPathKey(pathKey);
    if (activePathIds.some((id) => id in toggled)) {
      setToggled((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([id]) => !activePathIds.includes(id))),
      );
    }
  }

  if (!teamId || groups.length === 0) return null;

  const isOpen = (groupId: string) => toggled[groupId] ?? activePathIds.includes(groupId);
  // 펼침 단추가 읽어 주는 이름 — 같은 이름의 하위 그룹(「2026」)이 여러 상위 그룹 밑에 선다.
  const pathLabels = listSurveyGroupPathLabels(ownGroups);
  const toggle = (groupId: string) =>
    setToggled((prev) => ({
      ...prev,
      [groupId]: !(prev[groupId] ?? activePathIds.includes(groupId)),
    }));

  return (
    <div className="flex flex-col gap-1 pt-0.5">
      {ownGroups.length > 0 && (
        <GroupBranch
          nodes={buildSurveyGroupTree(ownGroups)}
          label="설문 그룹"
          activeGroupId={activeGroupId}
          isOpen={isOpen}
          onToggle={toggle}
          spokenNameOf={(group) => pathLabels.get(group.id) ?? group.name}
        />
      )}
      {collabGroups.length > 0 && (
        <ul aria-label="협업 그룹" className="flex flex-col gap-[1px]">
          {collabGroups.map((group) => (
            <li key={group.id}>
              <CollabGroupLink group={group} active={group.id === activeGroupId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 한 단계의 형제 줄들. 펼쳐진 줄 아래에 자기 자신을 다시 그려 3단계까지 내려간다. */
function GroupBranch({
  nodes,
  label,
  activeGroupId,
  isOpen,
  onToggle,
  spokenNameOf,
}: {
  nodes: GroupNode[];
  /** 맨 위 목록에만 붙는 이름 — 안쪽 목록은 자기를 여닫는 화살표가 이름을 대신한다. */
  label?: string;
  activeGroupId: string | null;
  isOpen: (groupId: string) => boolean;
  onToggle: (groupId: string) => void;
  /**
   * 펼침 단추가 읽어 줄 이름 — 뿌리부터의 경로(「이정운 › 2026」). 들여쓰기는 눈에만 보여서, 이름만
   * 읽으면 같은 이름의 하위 그룹 둘이 구별되지 않는다. 줄에 보이는 글자와 링크의 이름은 그대로다.
   */
  spokenNameOf: (group: SurveyGroupListItem) => string;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-[1px]">
      {nodes.map(({ group, depth, children }) => {
        const active = group.id === activeGroupId;
        const hasChildren = children.length > 0;
        const open = hasChildren && isOpen(group.id);
        const FolderIcon = open || active ? FolderOpen : Folder;
        return (
          <li key={group.id} className="flex flex-col gap-[1px]">
            <div
              className={cn(
                'flex items-center rounded-[7px] text-[12.5px] transition-colors',
                active
                  ? 'bg-white/10 font-semibold text-white'
                  : 'font-normal text-white/75 hover:bg-white/10 hover:text-white',
              )}
              style={{ paddingLeft: ROOT_INSET + (depth - 1) * DEPTH_INDENT }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={`${spokenNameOf(group)} ${open ? '접기' : '펼치기'}`}
                  aria-expanded={open}
                  onClick={() => onToggle(group.id)}
                  className="flex w-5 shrink-0 items-center justify-center self-stretch rounded-[5px] text-white/55 hover:text-white"
                >
                  {open ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
              ) : (
                // 화살표가 없는 줄도 같은 자리를 비워 폴더가 형제와 한 줄로 선다.
                <span aria-hidden className="w-5 shrink-0" />
              )}
              <Link
                href={`/surveys?group=${group.id}`}
                title={group.name}
                aria-current={active ? 'page' : undefined}
                className="flex min-w-0 flex-1 items-center gap-[7px] rounded-[7px] py-[7px] pr-2.5"
              >
                <FolderIcon
                  className={cn('h-[13px] w-[13px] shrink-0', !active && 'text-white/60')}
                />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="shrink-0 text-[11px] text-white/45">{group.surveyCount}</span>
              </Link>
            </div>
            {open && (
              <GroupBranch
                nodes={children}
                activeGroupId={activeGroupId}
                isOpen={isOpen}
                onToggle={onToggle}
                spokenNameOf={spokenNameOf}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 협업 그룹 줄 — 이름 아래에 소유 팀. 트리에 서지 않으므로 화살표도 들여쓰기도 없다. */
function CollabGroupLink({ group, active }: { group: SurveyGroupListItem; active: boolean }) {
  return (
    <Link
      href={`/surveys?group=${group.id}`}
      title={`${group.name} · ${group.foreignTeamName}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-[7px] rounded-[7px] py-[7px] pr-2.5 pl-6 text-[12.5px] transition-colors',
        active
          ? 'bg-white/10 font-semibold text-white'
          : 'font-normal text-white/75 hover:bg-white/10 hover:text-white',
      )}
    >
      <Folder className={cn('h-[13px] w-[13px] shrink-0', !active && 'text-white/60')} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{group.name}</span>
        <span className="truncate text-[10.5px] font-normal text-white/45">
          {group.foreignTeamName}
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-white/45">{group.surveyCount}</span>
    </Link>
  );
}
