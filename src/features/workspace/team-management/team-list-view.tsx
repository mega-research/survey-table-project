'use client';

import { useState } from 'react';

import Link from 'next/link';

import { ArrowLeft, Loader2, MoreVertical, Plus, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SYSTEM_SCOPE } from '@/shared/contracts/workspace';
import type { TeamListItem } from '@/shared/contracts/workspace-io';
import { useWorkScopeOptional } from '@/shared/lib/work-scope-context';

import { PRIMARY_BUTTON } from '../field-styles';

import { useTeams } from './queries/use-teams';
import { TeamDissolveModal } from './team-dissolve-modal';
import { TeamFormModal } from './team-form-modal';

/** 카드 하단 지표 — `3 멤버 · 8 설문` (.pen FLOW 7-1). */
function CardStats({ items }: { items: { value: number; label: string }[] }) {
  return (
    <div className="flex gap-[14px] pt-[6px] text-[13px] text-[#374151]">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-[3px]">
          <span className="font-bold">{item.value}</span>
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function TeamCard({ team, onDissolve }: { team: TeamListItem; onDissolve: () => void }) {
  return (
    <div className="flex flex-col gap-[5px] rounded-xl border border-[#E5E5EA] bg-white p-[14px]">
      <div className="flex items-center justify-between">
        <span className="text-[15.5px] font-semibold text-[#1C1C1E]">{team.name}</span>
        {/* 케밥은 일반 팀 카드에만 있다 — 메가리서치는 팀이 아니라 대상이 될 수 없다. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`${team.name} 메뉴`}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F5F5F7] text-[#6E6E73] hover:bg-[#EEF0F4]"
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[150px]">
            <DropdownMenuItem asChild>
              <Link href={`/admin/teams/${team.id}`}>팀 상세</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* .pen FLOW 7-1 의 케밥은 이 항목을 **항상 강조**해 둔다(bg #FEF2F2) — 되돌릴 수
                없는 액션이라 hover 로만 드러나면 안 된다. 말줄임표도 목업 그대로: 누르는 즉시
                일어나지 않고 확인 단계가 하나 더 있다는 뜻이다. */}
            <DropdownMenuItem
              onSelect={onDissolve}
              className="justify-between bg-[#FEF2F2] font-semibold text-[#EF4444] focus:bg-[#FEE2E2] focus:text-[#EF4444]"
            >
              팀 해산…
              <TriangleAlert className="h-3.5 w-3.5" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* 카드 부제는 팀마다 다른 설명이 아니라 고정 문구다 — 팀이 무엇인지를 말한다(.pen 7-1). */}
      <span className="text-[13px] text-[#6E6E73]">독립 접근 단위</span>
      <CardStats
        items={[
          { value: team.memberCount, label: '멤버' },
          { value: team.surveyCount, label: '설문' },
        ]}
      />
    </div>
  );
}

/**
 * 팀 관리 (.pen FLOW 7-1) — 슈퍼어드민 전용.
 *
 * 맨 위 「메가리서치」 카드는 팀이 아니라 시스템 전체 보기다(ADR-0006). teams 행이 없으므로
 * 케밥도 상세도 없고, 팀 수·전체 설문 수만 보여준다. 재배치 센터(티켓 14)가 이 카드로
 * 들어오는 유일한 입구가 된다.
 */
export function TeamListView() {
  const [createOpen, setCreateOpen] = useState(false);
  const [dissolveTarget, setDissolveTarget] = useState<TeamListItem | null>(null);
  const { data, isLoading, error } = useTeams();
  // 셸 밖(테스트 렌더)에서도 이 화면이 서므로 optional 로 받는다.
  const workScope = useWorkScopeOptional();

  const teams = data?.teams ?? [];
  const summary = data?.systemSummary;

  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-8">
      <div className="mx-auto max-w-[1048px] space-y-6">
        <Link
          href="/admin/surveys"
          className="inline-flex items-center gap-1 text-[13px] text-[#6E6E73] hover:text-[#1C1C1E]"
        >
          <ArrowLeft className="h-4 w-4" />
          설문 목록
        </Link>

        <div className="flex items-start justify-between">
          <h1 className="text-[22px] font-semibold text-[#1C1C1E]">팀 관리</h1>
          <Button
            onClick={() => setCreateOpen(true)}
            className={PRIMARY_BUTTON}
          >
            <Plus className="mr-1 h-4 w-4" />새 팀
          </Button>
        </div>

        <section className="flex flex-col gap-[5px] rounded-xl border border-[#C7D2FE] bg-[#EEF2FF] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[17px] font-semibold text-[#1C1C1E]">메가리서치</span>
            <span className="rounded-full bg-[#DBEAFE] px-[9px] py-1 text-[11px] font-semibold text-[#2E4FCE]">
              시스템 전체 보기
            </span>
          </div>
          <span className="text-[13px] text-[#6E6E73]">
            슈퍼어드민 전용 · 모든 팀 · 재배치 센터
          </span>
          <CardStats
            items={[
              { value: summary?.teamCount ?? 0, label: '팀' },
              { value: summary?.surveyCount ?? 0, label: '전체 설문' },
            ]}
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-[#1C1C1E]">조직 단위</h2>
            <span className="text-[11.5px] font-medium text-[#9CA3AF]">
              전체 조직명을 포함한 독립 팀 · 자동 공유 없음
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                onDissolve={() => setDissolveTarget(team)}
              />
            ))}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[#6E6E73]">
              <Loader2 className="h-4 w-4 animate-spin" />팀 목록을 불러오는 중...
            </div>
          )}
          {error && (
            <p className="py-10 text-center text-[13px] text-red-600">
              팀 목록을 불러오지 못했습니다.
            </p>
          )}
          {!isLoading && !error && teams.length === 0 && (
            <p className="py-10 text-center text-[13px] text-[#9CA3AF]">
              아직 팀이 없습니다. 「새 팀」으로 조직 단위를 만드세요.
            </p>
          )}

          <p className="pt-2 text-[11.5px] leading-relaxed text-[#9CA3AF]">
            팀 이름에 전체 조직 경로를 포함합니다. 각 카드는 독립 접근 단위이며, 특정 설문에
            명시적으로 초대할 때만 타 팀 사용자가 접근합니다.
          </p>
        </section>
      </div>

      {createOpen && <TeamFormModal onClose={() => setCreateOpen(false)} />}
      {dissolveTarget && (
        <TeamDissolveModal
          team={dissolveTarget}
          onClose={() => setDissolveTarget(null)}
          onDissolved={(team) => {
            // 해산한 팀을 보고 있었다면 작업 범위를 시스템 전체 보기로 되돌린다. 안 그러면
            // 쿠키에 남은 teamId 로 스위처가 「알 수 없는 팀」에 갇힌다 — 슈퍼어드민의 팀
            // 범위는 멤버십으로 걸러지지 않아 archived 팀 id 도 그대로 통과한다.
            if (workScope?.scope.kind === 'team' && workScope.scope.teamId === team.id) {
              workScope.setScope(SYSTEM_SCOPE);
            }
          }}
        />
      )}
    </div>
  );
}
