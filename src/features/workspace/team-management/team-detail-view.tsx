'use client';

import { useState } from 'react';

import Link from 'next/link';

import { Loader2, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { MemberAddModal } from './member-add-modal';
import { useTeamDetail } from './queries/use-teams';
import { TeamFormModal } from './team-form-modal';
import { TeamMemberRow } from './team-member-row';

interface Props {
  teamId: string;
}

/**
 * 팀 상세 (.pen FLOW 7-2) — 멤버 표 + 직책·역할 편집 + 팀원 추가.
 *
 * 슈퍼어드민과 그 팀 팀장만 열린다. 자격이 없으면 서버가 NOT_FOUND 를 돌려주므로 화면도
 * "찾을 수 없다" 로 끝난다 — 존재 여부를 알려주지 않는다.
 *
 * 「설문」 탭은 아직 열 것이 없다. 설문이 팀에 귀속되는 것은 티켓 07 이고, 목록 개편은 08 이다.
 */
export function TeamDetailView({ teamId }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: team, isLoading, error } = useTeamDetail(teamId);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-[#F9FAFB] text-[13px] text-[#6E6E73]">
        <Loader2 className="h-4 w-4 animate-spin" />팀 정보를 불러오는 중...
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F9FAFB]">
        <p className="text-[13px] text-[#6E6E73]">팀을 찾을 수 없습니다.</p>
        <Link href="/admin/teams" className="text-[13px] text-[#2E4FCE] hover:underline">
          팀 관리로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-8">
      <div className="mx-auto max-w-[1048px] space-y-5">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-[#6E6E73]">
              <Link href="/admin/teams" className="hover:text-[#1C1C1E]">
                팀 관리
              </Link>
              {` / ${team.name}`}
            </span>
            <h1 className="text-[24px] font-semibold text-[#1C1C1E]">{team.name}</h1>
          </div>
          {team.canManageMembers && (
            <Button
              onClick={() => setAddOpen(true)}
              className="h-9 rounded-lg bg-[#2E4FCE] px-[14px] text-[13.5px] font-semibold text-white hover:bg-[#2743AE]"
            >
              <UserPlus className="mr-1.5 h-[15px] w-[15px]" />
              팀원 추가
            </Button>
          )}
        </div>

        <div className="flex gap-0.5 border-b border-[#E5E5EA]">
          <span className="border-b-2 border-[#2E4FCE] px-[18px] py-[9px] text-[14px] font-semibold text-[#2743AE]">
            {`멤버 ${team.memberCount}`}
          </span>
          <span
            // 설문 탭은 티켓 07(설문 팀 귀속) 이후에 열린다 — 지금 눌러도 보여줄 것이 없다.
            aria-disabled
            title="설문이 팀에 귀속되면 열립니다."
            className="cursor-not-allowed px-[18px] py-[9px] text-[14px] text-[#C7C7CC]"
          >
            {`설문 ${team.surveyCount}`}
          </span>
          {/* 설정 탭은 늘 자리에 있다(.pen 7-2 는 3탭). 다만 팀 이름은 조직 경로라 슈퍼어드민만
              고친다(ADR-0008) — 팀장에게는 보이되 잠긴다. */}
          <button
            type="button"
            disabled={!team.canManageSettings}
            title={team.canManageSettings ? undefined : '팀 이름은 슈퍼어드민이 관리합니다.'}
            onClick={() => setSettingsOpen(true)}
            className="px-[18px] py-[9px] text-[14px] text-[#6E6E73] hover:text-[#1C1C1E] disabled:cursor-not-allowed disabled:text-[#C7C7CC] disabled:hover:text-[#C7C7CC]"
          >
            설정
          </button>
        </div>

        <div className="flex gap-[14px] px-[22px] text-[12px] font-medium text-[#9CA3AF]">
          <span className="w-[300px]">멤버</span>
          <span className="w-[180px]">직책</span>
          <span className="w-[140px]">역할</span>
        </div>

        <div className="space-y-2">
          {team.members.map((member) => (
            <TeamMemberRow
              key={member.userId}
              teamId={teamId}
              member={member}
              canManage={team.canManageMembers}
            />
          ))}
          {team.members.length === 0 && (
            <p className="py-10 text-center text-[13px] text-[#9CA3AF]">
              아직 팀원이 없습니다. 「팀원 추가」로 미배치 사용자를 당겨오세요.
            </p>
          )}
        </div>

        <p className="text-[11.5px] leading-relaxed text-[#9CA3AF]">
          직책은 팀장과 슈퍼어드민이 입력·수정할 수 있습니다. 소속 조직은 팀 멤버십으로만
          관리합니다.
        </p>
      </div>

      {addOpen && <MemberAddModal teamId={teamId} onClose={() => setAddOpen(false)} />}
      {settingsOpen && (
        <TeamFormModal team={{ id: team.id, name: team.name }} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
