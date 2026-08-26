'use client';

import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/get-error-message';
import { isActiveUser } from '@/shared/contracts/auth';
import { TEAM_ROLE_LABEL, teamRoleValues, type TeamRole } from '@/shared/contracts/workspace';
import type { TeamMemberItem } from '@/shared/contracts/workspace-io';

import { USER_STATUS_LABEL } from '../user-management/user-vocabulary';

import {
  useChangeTeamMemberRole,
  useRemoveTeamMember,
  useUpdateMemberJobTitle,
} from './queries/use-teams';

interface Props {
  teamId: string;
  member: TeamMemberItem;
  /** 팀장·슈퍼어드민만 직책·역할·제외를 다룬다. 판정의 정본은 서버다. */
  canManage: boolean;
}

/**
 * 팀 상세의 멤버 한 행 (.pen FLOW 7-2).
 *
 * 직책은 입력을 벗어날 때 저장한다 — 글자마다 왕복하지 않고, 저장 버튼도 두지 않는 인라인
 * 편집이다. 입력은 비제어(defaultValue + key)로 둔다: 다른 사람이 값을 바꿔 목록이 새로
 * 오면 key 가 달라져 입력이 새 값으로 다시 마운트되고, effect 로 상태를 맞출 일이 없다.
 */
export function TeamMemberRow({ teamId, member, canManage }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const changeRole = useChangeTeamMemberRole();
  const removeMember = useRemoveTeamMember();
  const updateJobTitle = useUpdateMemberJobTitle(teamId);
  const isPending = changeRole.isPending || removeMember.isPending || updateJobTitle.isPending;

  async function commitJobTitle(next: string) {
    const trimmed = next.trim();
    if (trimmed === (member.jobTitle ?? '')) return;
    setError(null);
    try {
      await updateJobTitle.mutateAsync({
        teamId,
        userId: member.userId,
        jobTitle: trimmed === '' ? null : trimmed,
      });
    } catch (err) {
      setError(getErrorMessage(err, '직책을 저장하지 못했습니다.'));
    }
  }

  async function commitRole(next: TeamRole) {
    if (next === member.role) return;
    setError(null);
    try {
      await changeRole.mutateAsync({ teamId, userId: member.userId, role: next });
    } catch (err) {
      // 마지막 팀장 강등은 서버가 CONFLICT 로 막는다 — 문구를 그대로 띄운다.
      setError(getErrorMessage(err, '역할을 바꾸지 못했습니다.'));
    }
  }

  async function confirmRemoval() {
    setError(null);
    try {
      await removeMember.mutateAsync({ teamId, userId: member.userId });
      setConfirmRemove(false);
    } catch (err) {
      setError(getErrorMessage(err, '팀원을 제외하지 못했습니다.'));
    }
  }

  return (
    <div className="rounded-xl border border-[#E5E5EA] bg-white px-[22px] py-[15px]">
      <div className="flex items-center gap-[14px]">
        <div className="flex w-[300px] items-center gap-3">
          <span
            aria-hidden
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#E0E7FF] text-[14px] font-semibold text-[#2743AE]"
          >
            {member.name.slice(0, 1)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[14.5px] font-semibold text-[#1C1C1E]">
                {member.name}
              </span>
              {/* 비활성 멤버는 표식을 단다 — 정지·퇴사한 사람이 팀장 자리에 남아 있는 것을
                  화면에서 알아볼 수 있어야 한다(재배치는 티켓 14 소관). */}
              {!isActiveUser(member.status) && (
                <span className="shrink-0 rounded-full bg-[#F5F5F7] px-2 py-[2px] text-[10.5px] font-semibold text-[#6E6E73]">
                  {USER_STATUS_LABEL[member.status]}
                </span>
              )}
            </span>
            <span className="truncate text-[12px] text-[#6E6E73]">
              {member.email}
              {/* 겸직 표기 — 이 사람이 다른 활성 팀에도 속해 있다는 사실은 제외·역할 판단에 필요하다. */}
              {member.otherTeamCount > 0 ? ` · ${member.otherTeamCount}팀 겸직` : ''}
            </span>
          </span>
        </div>

        <label className="sr-only" htmlFor={`job-title-${member.userId}`}>
          {member.name} 직책
        </label>
        <input
          id={`job-title-${member.userId}`}
          key={member.jobTitle ?? ''}
          defaultValue={member.jobTitle ?? ''}
          disabled={!canManage || isPending}
          onBlur={(e) => void commitJobTitle(e.target.value)}
          placeholder="직책 없음"
          className="h-[38px] w-[180px] rounded-[9px] border border-[#E5E5EA] px-3 text-[13px] text-[#374151] placeholder:text-[#9CA3AF] disabled:bg-[#F9FAFB]"
        />

        <label className="sr-only" htmlFor={`role-${member.userId}`}>
          {member.name} 역할
        </label>
        <select
          id={`role-${member.userId}`}
          value={member.role}
          disabled={!canManage || isPending}
          onChange={(e) => void commitRole(e.target.value as TeamRole)}
          className="h-[38px] w-[140px] rounded-[9px] border border-[#E5E5EA] px-3 text-[13px] text-[#374151] disabled:bg-[#F9FAFB]"
        >
          {teamRoleValues.map((role) => (
            <option key={role} value={role}>
              {TEAM_ROLE_LABEL[role]}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        {canManage && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirmRemove(true)}
            className="text-[13.5px] font-medium text-[#EF4444] hover:underline disabled:opacity-50"
          >
            제외
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{member.name} 님을 팀에서 제외할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              제외하면 이 팀의 설문 경로가 닫힙니다. 다른 팀에 겸직 중이면 그 팀에는 그대로
              남습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-[12.5px] text-red-600">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button
              type="button"
              disabled={isPending}
              onClick={() => void confirmRemoval()}
              className="bg-[#EF4444] text-white hover:bg-[#DC2626]"
            >
              제외
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
